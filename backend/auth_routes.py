import secrets
from datetime import timedelta
import bcrypt
import httpx
from fastapi import APIRouter, HTTPException, Request, Response, Depends
from pydantic import BaseModel, EmailStr, Field
from core import db, now, iso, new_id, get_current_user, create_default_folders, audit, storage

router = APIRouter(prefix="/api/auth")
EMERGENT_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=80)
    account_type: str = "individual"


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class GoogleIn(BaseModel):
    session_id: str


def hash_pw(p):
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def check_pw(p, h):
    return bool(h) and bcrypt.checkpw(p.encode(), h.encode())


async def create_user(email, name, picture=None, password=None, account_type="individual", role="user"):
    user = {"user_id": new_id("user"), "email": email.lower(), "name": name, "picture": picture,
            "password_hash": hash_pw(password) if password else None, "role": role, "status": "active",
            "account_type": account_type if account_type in ("individual", "business") else "individual",
            "plan_id": "free", "renewal_date": None, "cancel_at_period_end": False, "created_at": iso()}
    await db.users.insert_one(dict(user))
    await create_default_folders(user["user_id"])
    return user


async def start_session(response, user_id, request, method):
    token = secrets.token_urlsafe(40)
    await db.user_sessions.insert_one({
        "session_id": new_id("ses"), "session_token": token, "user_id": user_id, "method": method,
        "user_agent": request.headers.get("user-agent", "")[:200], "created_at": iso(),
        "expires_at": iso(now() + timedelta(days=7))})
    response.set_cookie("session_token", token, httponly=True, secure=True, samesite="none",
                        path="/", max_age=7 * 86400)
    return token


async def public_user(user_id):
    return await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})


@router.post("/register")
async def register(body: RegisterIn, request: Request, response: Response):
    if await db.users.find_one({"email": body.email.lower()}):
        raise HTTPException(409, "An account with this email already exists")
    user = await create_user(body.email, body.name, password=body.password, account_type=body.account_type)
    token = await start_session(response, user["user_id"], request, "password")
    await audit(user["user_id"], "auth.register")
    return {"user": await public_user(user["user_id"]), "token": token}


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response):
    email = body.email.lower()
    att = await db.login_attempts.find_one({"email": email}) or {}
    if att.get("count", 0) >= 5 and att.get("until", "") > iso():
        raise HTTPException(429, "Too many attempts. Try again in 15 minutes.")
    user = await db.users.find_one({"email": email})
    if not user or not check_pw(body.password, user.get("password_hash")):
        cnt = att.get("count", 0) + 1 if att.get("until", "") > iso() or not att else 1
        await db.login_attempts.update_one({"email": email}, {"$set": {"count": cnt, "until": iso(now() + timedelta(minutes=15))}}, upsert=True)
        raise HTTPException(401, "Incorrect email or password")
    if user.get("status") == "suspended":
        raise HTTPException(403, "Account suspended")
    await db.login_attempts.delete_one({"email": email})
    token = await start_session(response, user["user_id"], request, "password")
    await audit(user["user_id"], "auth.login")
    return {"user": await public_user(user["user_id"]), "token": token}


@router.post("/google/session")
async def google_session(body: GoogleIn, request: Request, response: Response):
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(EMERGENT_SESSION_URL, headers={"X-Session-ID": body.session_id})
    if r.status_code != 200:
        raise HTTPException(401, "Google sign-in failed")
    data = r.json()
    user = await db.users.find_one({"email": data["email"].lower()}, {"_id": 0})
    if not user:
        user = await create_user(data["email"], data.get("name") or data["email"], picture=data.get("picture"))
    elif data.get("picture"):
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"picture": data["picture"]}})
    if user.get("status") == "suspended":
        raise HTTPException(403, "Account suspended")
    token = await start_session(response, user["user_id"], request, "google")
    await audit(user["user_id"], "auth.google_login")
    return {"user": await public_user(user["user_id"]), "token": token}


@router.get("/me")
async def me(user=Depends(get_current_user)):
    user.pop("_session_id", None)
    return user


@router.post("/logout")
async def logout(request: Request, response: Response):
    auth = request.headers.get("Authorization", "")
    token = request.cookies.get("session_token") or (auth[7:] if auth.startswith("Bearer ") else None)
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/", secure=True, samesite="none")
    return {"ok": True}


@router.get("/sessions")
async def sessions(user=Depends(get_current_user)):
    rows = await db.user_sessions.find({"user_id": user["user_id"]}, {"_id": 0, "session_token": 0}).sort("created_at", -1).to_list(50)
    for r in rows:
        r["current"] = r["session_id"] == user["_session_id"]
    return rows


@router.delete("/sessions/{session_id}")
async def revoke(session_id: str, user=Depends(get_current_user)):
    await db.user_sessions.delete_one({"session_id": session_id, "user_id": user["user_id"]})
    await audit(user["user_id"], "auth.session_revoked", {"session_id": session_id})
    return {"ok": True}


class DeleteIn(BaseModel):
    confirm: str


@router.post("/delete-account")
async def delete_account(body: DeleteIn, response: Response, user=Depends(get_current_user)):
    if body.confirm != "DELETE":
        raise HTTPException(400, "Type DELETE to confirm")
    if user.get("role") == "admin":
        raise HTTPException(400, "Admin accounts cannot be deleted here")
    uid = user["user_id"]
    async for f in db.files.find({"user_id": uid}, {"storage_key": 1}):
        storage.delete(f["storage_key"])
    for col in ("files", "folders", "shares", "user_sessions", "migration_jobs", "uploads"):
        await db[col].delete_many({"user_id": uid})
    await db.users.delete_one({"user_id": uid})
    await audit(uid, "account.deleted")
    response.delete_cookie("session_token", path="/", secure=True, samesite="none")
    return {"ok": True}
