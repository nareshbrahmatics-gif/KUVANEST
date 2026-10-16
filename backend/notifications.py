import io
import os
import json
import asyncio
import logging
from datetime import datetime, timedelta
from html import escape
import hmac
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from pymongo.errors import DuplicateKeyError
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet
from core import db, iso, now, new_id, get_current_user, usage_bytes, quota_bytes
from emailer import send_email

router = APIRouter(prefix="/api")
log = logging.getLogger("notify")
SAC = "998315"


def app_url(path):
    return f"{os.environ['APP_URL'].rstrip('/')}{path}"


def _wrap(title, body_html, cta_text, link):
    brand = escape(os.environ["EMAIL_FROM_NAME"])
    return (
        '<table role="presentation" width="100%" style="background:#F7F7F7;padding:24px 0"><tr><td align="center">'
        '<table role="presentation" width="520" style="background:#ffffff;border-radius:16px;font-family:Arial,sans-serif;color:#202124">'
        f'<tr><td style="background:#1F94C8;border-radius:16px 16px 0 0;padding:22px 28px;color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:4px">{brand.upper()}</td></tr>'
        f'<tr><td style="padding:28px"><p style="font-size:18px;font-weight:bold;margin:0 0 12px">{escape(title)}</p>{body_html}'
        f'<a href="{escape(link)}" style="display:inline-block;background:#E5AA16;color:#202124;text-decoration:none;font-weight:bold;'
        f'padding:14px 28px;border-radius:12px;font-size:16px">{escape(cta_text)}</a>'
        f'<p style="font-size:12px;color:#80868B;margin:24px 0 0">Sent by {brand}. We never ask for your password or payment details by email.</p>'
        '</td></tr></table></td></tr></table>')


def _p(text):
    return f'<p style="font-size:15px;line-height:1.6;color:#5F6368;margin:0 0 20px">{text}</p>'


async def notify(user_id, ntype, title, body, link):
    await db.notifications.insert_one({"notification_id": new_id("ntf"), "user_id": user_id, "type": ntype, "title": title,
                                       "body": body, "link": link, "read": False, "created_at": iso()})


async def safe_email(**kw):
    try:
        return await send_email(**kw)
    except Exception:
        log.exception("email failed")


# ---------- notifications API ----------
@router.get("/notifications")
async def list_notifications(user=Depends(get_current_user)):
    items = await db.notifications.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).sort("created_at", -1).to_list(30)
    return {"items": items, "unread": await db.notifications.count_documents({"user_id": user["user_id"], "read": False})}


@router.post("/notifications/read-all")
async def read_all(user=Depends(get_current_user)):
    await db.notifications.update_many({"user_id": user["user_id"], "read": False}, {"$set": {"read": True}})
    return {"ok": True}


# ---------- storage alerts ----------
async def check_storage_alert(user_id):
    try:
        user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        q = await quota_bytes(user)
        pct = (await usage_bytes(user_id)) / q * 100 if q else 0
        level = 95 if pct >= 95 else 80 if pct >= 80 else 0
        prev = user.get("storage_alert_level", 0)
        if level == prev:
            return
        prev_q = {"$in": [0, None]} if not prev else prev
        r = await db.users.update_one({"user_id": user_id, "storage_alert_level": prev_q}, {"$set": {"storage_alert_level": level}})
        if not r.modified_count or level < prev:
            return
        title = f"Your KuvaNest storage is {int(pct)}% full"
        body = ("You're almost out of space. New uploads and backups will stop when storage is full."
                if level == 95 else "You've used most of your storage. Free up space or upgrade to keep backing up.")
        await notify(user_id, "storage", title, body, "/plans")
        html = _wrap(title, _p(escape(body)), "See storage plans", app_url("/plans"))
        await safe_email(to=user["email"], subject=title, html=html)
    except Exception:
        log.exception("storage alert check failed")


def schedule_storage_check(user_id):
    asyncio.create_task(check_storage_alert(user_id))


# ---------- GST invoice PDF ----------
def invoice_pdf(pay, user, gst_pct):
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm)
    ss = getSampleStyleSheet()
    blue = colors.HexColor("#1F94C8")
    seller = [os.environ.get("INVOICE_SELLER_NAME", "KuvaNest"), os.environ.get("INVOICE_ADDRESS", ""),
              f"GSTIN: {os.environ.get('INVOICE_GSTIN') or 'Not yet registered'}"]
    tax = pay.get("gst", 0)
    head = Table([[Paragraph('<font size="20" color="#FFFFFF"><b>KUVANEST</b></font>', ss["Normal"]),
                   Paragraph('<para align="right"><font size="14" color="#FFFFFF"><b>TAX INVOICE</b></font></para>', ss["Normal"])]],
                 colWidths=[90 * mm, 84 * mm])
    head.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), blue), ("PADDING", (0, 0), (-1, -1), 10)]))
    paid_at = (pay.get("paid_at") or pay["created_at"])[:10]
    meta = Table([
        [Paragraph("<b>From</b><br/>" + "<br/>".join(escape(x) for x in seller if x), ss["Normal"]),
         Paragraph(f"<b>Invoice no:</b> {escape(pay['invoice_no'])}<br/><b>Date:</b> {paid_at}<br/>"
                   f"<b>Payment:</b> {escape(str(pay.get('method', '')).upper())} · {escape(pay.get('status', ''))}<br/>"
                   f"<b>Ref:</b> {escape(pay.get('razorpay_payment_id') or pay['payment_id'])}", ss["Normal"])],
        [Paragraph(f"<b>Bill to</b><br/>{escape(user.get('name', ''))}<br/>{escape(user.get('email', ''))}", ss["Normal"]), ""],
    ], colWidths=[100 * mm, 74 * mm])
    meta.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOTTOMPADDING", (0, 0), (-1, -1), 10)]))
    lines = Table([
        ["Description", "SAC", "Amount (INR)"],
        [f"KuvaNest {pay['plan_name']} plan — monthly subscription", SAC, f"{pay['amount']:.2f}"],
        ["", f"IGST @ {gst_pct:g}%", f"{tax:.2f}"],
        ["", "Total", f"{pay['total']:.2f}"],
    ], colWidths=[104 * mm, 34 * mm, 36 * mm])
    lines.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F7F7F7")), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (1, 3), (-1, 3), "Helvetica-Bold"), ("LINEABOVE", (1, 3), (-1, 3), 1, colors.HexColor("#202124")),
        ("ALIGN", (2, 0), (2, -1), "RIGHT"), ("PADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 0), (-1, 1), 0.5, colors.HexColor("#E5E5E5"))]))
    note = Paragraph('<font size="8" color="#5F6368">This is a computer-generated invoice. Tax shown as IGST; CGST/SGST split applies '
                     'for intra-state supply once seller GSTIN and customer state are configured.</font>', ss["Normal"])
    doc.build([head, Spacer(1, 10 * mm), meta, Spacer(1, 6 * mm), lines, Spacer(1, 10 * mm), note])
    return buf.getvalue()


@router.get("/billing/invoices/{payment_id}/pdf")
async def download_invoice(payment_id: str, user=Depends(get_current_user)):
    q = {"payment_id": payment_id} if user.get("role") == "admin" else {"payment_id": payment_id, "user_id": user["user_id"]}
    pay = await db.payments.find_one({**q, "status": {"$in": ["paid", "refunded"]}}, {"_id": 0})
    if not pay:
        raise HTTPException(404, "Invoice not found")
    owner = await db.users.find_one({"user_id": pay["user_id"]}, {"_id": 0, "name": 1, "email": 1}) or {}
    s = await db.settings.find_one({"key": "billing"}, {"_id": 0}) or {}
    pdf = invoice_pdf(pay, owner, s.get("gst_percent", 18))
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f'inline; filename="{pay["invoice_no"]}.pdf"'})


async def send_receipt(payment_id):
    try:
        pay = await db.payments.find_one({"payment_id": payment_id, "status": "paid"}, {"_id": 0})
        if not pay or pay.get("receipt_sent_at"):
            return
        user = await db.users.find_one({"user_id": pay["user_id"]}, {"_id": 0})
        title = f"Payment received — {pay['plan_name']} plan"
        body = _p(f"Hi {escape(user['name'].split(' ')[0])}, thanks for your payment of <b>₹{pay['total']:,.2f}</b> "
                  f"(incl. ₹{pay['gst']:,.2f} GST) for the {escape(pay['plan_name'])} plan. Invoice no. {escape(pay['invoice_no'])}.")
        link = app_url(f"/invoice/{payment_id}")
        await notify(pay["user_id"], "payment", title, f"Invoice {pay['invoice_no']} is ready to download.", f"/invoice/{payment_id}")
        if await safe_email(to=user["email"], subject=title, html=_wrap(title, body, "Download GST invoice (PDF)", link)):
            await db.payments.update_one({"payment_id": payment_id}, {"$set": {"receipt_sent_at": iso()}})
    except Exception:
        log.exception("receipt failed")


# ---------- renewal reminders (daily cron) ----------
async def renewal_reminders():
    t = now()
    cur = db.users.find({"renewal_date": {"$ne": None, "$gt": iso(t), "$lte": iso(t + timedelta(days=3))},
                         "cancel_at_period_end": {"$ne": True}}, {"_id": 0})
    async for u in cur:
        plan = await db.plans.find_one({"plan_id": u.get("plan_id")}, {"_id": 0})
        if not plan or plan["price"] <= 0:
            continue
        claim = await db.users.update_one({"user_id": u["user_id"], "renewal_reminder_for": {"$ne": u["renewal_date"]}},
                                          {"$set": {"renewal_reminder_for": u["renewal_date"]}})
        if not claim.modified_count:
            continue
        s = await db.settings.find_one({"key": "billing"}, {"_id": 0}) or {}
        total = round(plan["price"] * (1 + s.get("gst_percent", 18) / 100), 2)
        when = datetime.fromisoformat(u["renewal_date"]).strftime("%d %b %Y")
        title = f"Your {plan['name']} plan renews on {when}"
        body = _p(f"Hi {escape(u['name'].split(' ')[0])}, your KuvaNest {escape(plan['name'])} plan ({plan['storage_gb']} GB) renews on "
                  f"<b>{when}</b> for <b>₹{total:,.2f}</b> incl. GST. No action is needed to continue. "
                  "You can change or cancel your plan any time before then.")
        await notify(u["user_id"], "renewal", title, f"₹{total:,.2f} incl. GST on {when}.", "/plans")
        await safe_email(to=u["email"], subject=title, html=_wrap(title, body, "Manage my plan", app_url("/plans")))


DAILY_LOCK = asyncio.Lock()


async def daily_job():
    if DAILY_LOCK.locked():
        return
    async with DAILY_LOCK:
        await _daily_job()


async def _daily_job():
    try:
        await renewal_reminders()
        async for u in db.users.find({"status": {"$ne": "suspended"}}, {"_id": 0, "user_id": 1}):
            await check_storage_alert(u["user_id"])
    except Exception:
        log.exception("daily cron failed")


@router.post("/cron/daily")
async def cron_daily(request: Request):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    auth = request.headers.get("Authorization", "")
    secret = os.environ.get("WEBHOOK_CRON_SECRET", "")
    if not secret or not auth.startswith("Bearer ") or not hmac.compare_digest(auth[7:], secret):
        raise HTTPException(401, "Unauthorized")
    raw = await request.body()
    try:
        env = json.loads(raw) if raw.strip() else {}
    except ValueError:
        raise HTTPException(400, "Invalid body")
    run_id = request.headers.get("X-Webhook-Id") or (env or {}).get("run_id") or new_id("run")
    try:
        await db.cron_runs.insert_one({"run_id": run_id, "name": "daily", "created_at": iso()})
    except DuplicateKeyError:
        return {"status": "duplicate"}
    asyncio.create_task(daily_job())
    return {"status": "accepted"}
