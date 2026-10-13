import re
from datetime import timedelta
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from core import db, now, iso, new_id, get_current_user, require_admin, usage_bytes, get_plan, audit, GB

router = APIRouter(prefix="/api")

DEFAULT_PLANS = [
    {"plan_id": "free", "name": "Free", "price": 0, "storage_gb": 5, "members": 1, "audience": "individual",
     "features": ["5 GB storage", "Files & photos", "Archive import"]},
    {"plan_id": "starter", "name": "Starter", "price": 100, "storage_gb": 50, "members": 1, "audience": "individual",
     "features": ["50 GB storage", "Files & photos", "Manual backup", "Basic sharing"]},
    {"plan_id": "personal", "name": "Personal", "price": 199, "storage_gb": 200, "members": 1, "audience": "individual",
     "features": ["200 GB storage", "Auto photo backup", "Google, iCloud & Dropbox import", "File sharing"]},
    {"plan_id": "family", "name": "Family", "price": 499, "storage_gb": 1024, "members": 5, "audience": "individual",
     "features": ["1 TB storage", "Up to 5 members", "Shared family folders", "Priority restore"]},
    {"plan_id": "premium", "name": "Premium", "price": 999, "storage_gb": 2048, "members": 1, "audience": "individual",
     "features": ["2 TB storage", "Large-file uploads", "Multi-device backup", "Priority support"]},
    {"plan_id": "business", "name": "Business", "price": 2999, "storage_gb": 5120, "members": 25, "audience": "business",
     "features": ["5 TB pooled storage", "Up to 25 team members", "Admin audit logs", "Azure & OneDrive import"]},
]


async def seed_plans():
    for i, p in enumerate(DEFAULT_PLANS):
        if not await db.plans.find_one({"plan_id": p["plan_id"]}):
            await db.plans.insert_one({**p, "active": True, "order": i})
    if not await db.settings.find_one({"key": "billing"}):
        await db.settings.insert_one({"key": "billing", "gst_percent": 18})


async def gst_percent():
    s = await db.settings.find_one({"key": "billing"}) or {}
    return s.get("gst_percent", 18)


@router.get("/plans")
async def plans():
    return await db.plans.find({"active": True}, {"_id": 0}).sort("order", 1).to_list(50)


@router.get("/billing")
async def billing(user=Depends(get_current_user)):
    invoices = await db.payments.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).sort("created_at", -1).to_list(100)
    return {"plan": await get_plan(user.get("plan_id", "free")), "renewal_date": user.get("renewal_date"),
            "cancel_at_period_end": user.get("cancel_at_period_end", False), "gst_percent": await gst_percent(),
            "invoices": invoices, "payment_mode": "mock"}


class SubIn(BaseModel):
    plan_id: str
    method: str = "upi"


@router.post("/billing/subscribe")
async def subscribe(body: SubIn, user=Depends(get_current_user)):
    plan = await db.plans.find_one({"plan_id": body.plan_id, "active": True}, {"_id": 0})
    if not plan:
        raise HTTPException(404, "Plan not found")
    if plan["plan_id"] == user.get("plan_id"):
        raise HTTPException(400, "You are already on this plan")
    if await usage_bytes(user["user_id"]) > plan["storage_gb"] * GB:
        raise HTTPException(400, "Your files use more space than this plan allows. Free up space first.")
    gst = await gst_percent()
    tax = round(plan["price"] * gst / 100, 2)
    pay = {"payment_id": new_id("pay"), "user_id": user["user_id"], "plan_id": plan["plan_id"], "plan_name": plan["name"],
           "amount": float(plan["price"]), "gst": tax, "total": round(plan["price"] + tax, 2), "currency": "INR",
           "method": body.method, "status": "paid", "provider": "mock", "invoice_no": f"KN-{now():%Y%m}-{new_id('')[1:7].upper()}",
           "created_at": iso()}
    if plan["price"] > 0:
        await db.payments.insert_one(dict(pay))
    old = await get_plan(user.get("plan_id", "free"))
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {
        "plan_id": plan["plan_id"], "cancel_at_period_end": False,
        "renewal_date": iso(now() + timedelta(days=30)) if plan["price"] > 0 else None}})
    await audit(user["user_id"], "billing.change_plan", {"from": old["plan_id"], "to": plan["plan_id"]})
    pay.pop("user_id")
    return {"ok": True, "payment": pay, "direction": "upgrade" if plan["price"] > old["price"] else "downgrade"}


@router.post("/billing/cancel")
async def cancel(user=Depends(get_current_user)):
    if user.get("plan_id", "free") == "free":
        raise HTTPException(400, "No paid plan to cancel")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"cancel_at_period_end": True}})
    await audit(user["user_id"], "billing.cancel_renewal")
    return {"ok": True}


@router.get("/admin/stats")
async def stats(_=Depends(require_admin)):
    plans = {p["plan_id"]: p for p in await db.plans.find({}, {"_id": 0}).to_list(50)}
    by_plan = await db.users.aggregate([{"$group": {"_id": "$plan_id", "n": {"$sum": 1}}}]).to_list(50)
    mrr = sum(plans.get(r["_id"], {}).get("price", 0) * r["n"] for r in by_plan)
    st = await db.files.aggregate([{"$group": {"_id": None, "s": {"$sum": "$size"}, "n": {"$sum": 1}}}]).to_list(1)
    return {"users": await db.users.count_documents({}),
            "active_subscriptions": sum(r["n"] for r in by_plan if r["_id"] not in (None, "free")),
            "mrr": mrr, "storage_bytes": st[0]["s"] if st else 0, "files": st[0]["n"] if st else 0,
            "migrations_running": await db.migration_jobs.count_documents({"status": {"$in": ["running", "queued", "paused"]}}),
            "migrations_failed": await db.migration_jobs.count_documents({"status": "failed"}),
            "by_plan": [{"plan": plans.get(r["_id"], {}).get("name", r["_id"]), "users": r["n"]} for r in by_plan],
            "business_accounts": await db.users.count_documents({"account_type": "business"})}


@router.get("/admin/users")
async def admin_users(q: str = "", _=Depends(require_admin)):
    query = {"$or": [{"email": {"$regex": re.escape(q), "$options": "i"}}, {"name": {"$regex": re.escape(q), "$options": "i"}}]} if q else {}
    users = await db.users.find(query, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(500)
    for u in users:
        u["used"] = await usage_bytes(u["user_id"])
    return users


class UserPatch(BaseModel):
    role: Optional[str] = None
    status: Optional[str] = None


@router.patch("/admin/users/{user_id}")
async def admin_user_patch(user_id: str, body: UserPatch, admin=Depends(require_admin)):
    if user_id == admin["user_id"]:
        raise HTTPException(400, "You cannot change your own account here")
    upd = {k: v for k, v in body.model_dump().items() if v}
    if upd.get("role") not in (None, "user", "admin") or upd.get("status") not in (None, "active", "suspended"):
        raise HTTPException(400, "Invalid value")
    await db.users.update_one({"user_id": user_id}, {"$set": upd})
    if upd.get("status") == "suspended":
        await db.user_sessions.delete_many({"user_id": user_id})
    await audit(admin["user_id"], "admin.user_update", {"user_id": user_id, **upd})
    return {"ok": True}


@router.get("/admin/migrations")
async def admin_migrations(_=Depends(require_admin)):
    rows = await db.migration_jobs.find({}, {"_id": 0, "errors": 0}).sort("created_at", -1).to_list(200)
    emails = {u["user_id"]: u["email"] for u in await db.users.find({}, {"user_id": 1, "email": 1}).to_list(5000)}
    for r in rows:
        r["email"] = emails.get(r["user_id"], "")
    return rows


@router.get("/admin/plans")
async def admin_plans(_=Depends(require_admin)):
    return {"plans": await db.plans.find({}, {"_id": 0}).sort("order", 1).to_list(50), "gst_percent": await gst_percent()}


class PlanPatch(BaseModel):
    name: Optional[str] = None
    price: Optional[float] = Field(None, ge=0)
    storage_gb: Optional[float] = Field(None, gt=0)
    members: Optional[int] = Field(None, ge=1)
    active: Optional[bool] = None
    features: Optional[List[str]] = None


@router.put("/admin/plans/{plan_id}")
async def admin_plan_update(plan_id: str, body: PlanPatch, admin=Depends(require_admin)):
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    r = await db.plans.update_one({"plan_id": plan_id}, {"$set": upd})
    if not r.matched_count:
        raise HTTPException(404, "Plan not found")
    await audit(admin["user_id"], "admin.plan_update", {"plan_id": plan_id, **upd})
    return await db.plans.find_one({"plan_id": plan_id}, {"_id": 0})


class GstIn(BaseModel):
    gst_percent: float = Field(ge=0, le=50)


@router.put("/admin/gst")
async def admin_gst(body: GstIn, admin=Depends(require_admin)):
    await db.settings.update_one({"key": "billing"}, {"$set": {"gst_percent": body.gst_percent}}, upsert=True)
    await audit(admin["user_id"], "admin.gst_update", {"gst_percent": body.gst_percent})
    return {"ok": True}


@router.get("/admin/payments")
async def admin_payments(_=Depends(require_admin)):
    return await db.payments.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


@router.get("/admin/audit")
async def admin_audit(_=Depends(require_admin)):
    return await db.audit_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(300)
