import os
import asyncio
import re
import ipaddress
import logging
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse
import httpx

log = logging.getLogger("email")
EMAIL_BASE_URL = "https://integrations.emergentagent.com"

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host):
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown, real):
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject, html):
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        if not _host_ok(urlparse(low).hostname or "") or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} != real link host {real!r} (G3)")


async def send_email(*, to, subject, html):
    _assert_safe_email(subject, html)
    payload = {"to": [to], "subject": subject, "html": html, "from_name": os.environ["EMAIL_FROM_NAME"]}
    if os.environ.get("EMAIL_REPLY_TO"):
        payload["contact_email"] = os.environ["EMAIL_REPLY_TO"]
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            for attempt in range(3):
                r = await c.post(f"{EMAIL_BASE_URL}/api/v1/email/send", headers={"X-Email-Key": os.environ["EMERGENT_EMAIL_KEY"]}, json=payload)
                if r.status_code != 429:
                    break
                await asyncio.sleep(2 * (attempt + 1))
        r.raise_for_status()
        return r.json().get("id")
    except httpx.HTTPStatusError as e:
        try:
            body = e.response.json()
        except ValueError:
            body = {}
        log.warning("Email not sent (%s %s): %s", e.response.status_code, body.get("code", ""), body.get("message", ""))
    except Exception as e:
        log.error("Email send error: %s", e)
    return None


def invite_email(owner_name, plan_name, link):
    brand = escape(os.environ["EMAIL_FROM_NAME"])
    subject = f"{owner_name} invited you to their {os.environ['EMAIL_FROM_NAME']} family"
    html = (
        '<table role="presentation" width="100%" style="background:#F7F7F7;padding:24px 0"><tr><td align="center">'
        '<table role="presentation" width="520" style="background:#ffffff;border-radius:16px;font-family:Arial,sans-serif;color:#202124">'
        f'<tr><td style="background:#1F94C8;border-radius:16px 16px 0 0;padding:22px 28px;color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:4px">{brand.upper()}</td></tr>'
        '<tr><td style="padding:28px">'
        f'<p style="font-size:18px;font-weight:bold;margin:0 0 12px">{escape(owner_name)} invited you to share family storage</p>'
        f'<p style="font-size:15px;line-height:1.6;color:#5F6368;margin:0 0 24px">Join their {escape(plan_name)} plan to share photos and files in a common '
        'Family Files folder. Your own folders always stay private.</p>'
        f'<a href="{escape(link)}" style="display:inline-block;background:#E5AA16;color:#202124;text-decoration:none;font-weight:bold;'
        'padding:14px 28px;border-radius:12px;font-size:16px">Join the family</a>'
        '<p style="font-size:12px;color:#80868B;margin:24px 0 0">Sign in or create a free account with this email address and the invitation is accepted automatically. '
        'If you weren\'t expecting this, you can ignore this email.</p>'
        f'<p style="font-size:12px;color:#80868B;margin:12px 0 0">Sent by {brand}. We never ask for your password or payment details by email.</p>'
        '</td></tr></table></td></tr></table>')
    return subject, html


def import_done_email(name, job, link):
    brand = escape(os.environ["EMAIL_FROM_NAME"])
    src = escape(job.get("source_label") or "your archive")
    ok = job["status"] == "completed"
    subject = f"Your {job.get('source_label') or 'archive'} import is {'complete' if ok else 'finished with problems'}"
    stats = "".join(f'<td style="padding:10px;text-align:center"><div style="font-size:22px;font-weight:bold;color:{c}">{v}</div>'
                    f'<div style="font-size:12px;color:#5F6368">{escape(k)}</div></td>'
                    for k, v, c in (("Imported", job.get("imported", 0), "#1E8E3E"), ("Duplicates skipped", job.get("duplicates", 0), "#5F6368"),
                                    ("Failed", job.get("failed", 0), "#D93025")))
    html = (
        '<table role="presentation" width="100%" style="background:#F7F7F7;padding:24px 0"><tr><td align="center">'
        '<table role="presentation" width="520" style="background:#ffffff;border-radius:16px;font-family:Arial,sans-serif;color:#202124">'
        f'<tr><td style="background:#1F94C8;border-radius:16px 16px 0 0;padding:22px 28px;color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:4px">{brand.upper()}</td></tr>'
        '<tr><td style="padding:28px">'
        f'<p style="font-size:18px;font-weight:bold;margin:0 0 8px">Hi {escape(name.split(" ")[0])}, your {src} import has finished</p>'
        f'<p style="font-size:15px;color:#5F6368;margin:0 0 16px">{job.get("processed", 0)} of {job.get("total_files", 0)} items were processed. '
        'Your original files were not changed.</p>'
        f'<table role="presentation" width="100%" style="background:#F7F7F7;border-radius:12px;margin-bottom:24px"><tr>{stats}</tr></table>'
        f'<a href="{escape(link)}" style="display:inline-block;background:#E5AA16;color:#202124;text-decoration:none;font-weight:bold;'
        'padding:14px 28px;border-radius:12px;font-size:16px">Open imported folder</a>'
        f'<p style="font-size:12px;color:#80868B;margin:24px 0 0">Sent by {brand}. We never ask for your password or payment details by email.</p>'
        '</td></tr></table></td></tr></table>')
    return subject, html


async def notify_import_done(db, job_id):
    try:
        from notifications import check_storage_alert, notify
        job = await db.migration_jobs.find_one({"job_id": job_id}, {"_id": 0, "items": 0})
        await check_storage_alert(job["user_id"])
        await notify(job["user_id"], "import", f"{job.get('source_label') or 'Archive'} import {job['status']}",
                     f"{job.get('imported', 0)} imported · {job.get('duplicates', 0)} duplicates · {job.get('failed', 0)} failed",
                     f"/files/{job['dest_folder_id']}" if job.get("dest_folder_id") else "/transfer")
        await _notify_import_done(db, job_id)
    except Exception:
        log.exception("import-done email failed for %s", job_id)


async def _notify_import_done(db, job_id):
    job = await db.migration_jobs.find_one({"job_id": job_id}, {"_id": 0, "items": 0})
    user = await db.users.find_one({"user_id": job["user_id"]}, {"_id": 0, "email": 1, "name": 1})
    if not user or job.get("notified_at"):
        return
    base = os.environ["APP_URL"].rstrip("/")
    link = f"{base}/files/{job['dest_folder_id']}" if job.get("dest_folder_id") else f"{base}/transfer"
    subject, html = import_done_email(user.get("name") or "there", job, link)
    if await send_email(to=user["email"], subject=subject, html=html):
        from core import iso
        await db.migration_jobs.update_one({"job_id": job_id}, {"$set": {"notified_at": iso()}})
