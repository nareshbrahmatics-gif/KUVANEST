import os
import logging
from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
from core import db, client
from auth_routes import router as auth_router, create_user, hash_pw
from file_routes import router as file_router
from migration import router as migration_router, resume_pending
from billing_admin import router as billing_router, seed_plans
from family import router as family_router
from albums import router as albums_router
from google_import import router as google_router
from notifications import router as notify_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
app = FastAPI(title="KuvaNest API")

for r in (auth_router, file_router, migration_router, billing_router, family_router, albums_router, google_router, notify_router):
    app.include_router(r)


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "kuvanest-api"}


async def seed_users():
    seeds = [(os.environ["ADMIN_EMAIL"], os.environ["ADMIN_PASSWORD"], "KuvaNest Admin", "admin"),
             (os.environ["DEMO_EMAIL"], os.environ["DEMO_PASSWORD"], "Priya Sharma", "user")]
    for email, pw, name, role in seeds:
        u = await db.users.find_one({"email": email.lower()})
        if not u:
            await create_user(email, name, password=pw, role=role)
        else:
            await db.users.update_one({"email": email.lower()}, {"$set": {"password_hash": hash_pw(pw), "role": role, "status": "active"}})


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.files.create_index([("user_id", 1), ("folder_id", 1)])
    await db.files.create_index([("user_id", 1), ("sha256", 1)])
    await db.folders.create_index([("user_id", 1), ("parent_id", 1)])
    await db.shares.create_index("token", unique=True)
    await db.webhook_events.create_index("event_id", unique=True)
    await db.family_members.create_index([("owner_id", 1), ("status", 1)])
    await db.google_oauth_states.create_index("state", unique=True)
    await db.cron_runs.create_index("run_id", unique=True)
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await seed_plans()
    await seed_users()
    await resume_pending()


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origin_regex=".*",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown():
    client.close()
