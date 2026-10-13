import os
import time
import asyncio
import hashlib
import secrets
import logging
from datetime import datetime
from urllib.parse import urlencode
from typing import List
import httpx
from cryptography.fernet import Fernet
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from core import (db, storage, iso, new_id, get_current_user, quota_bytes, usage_bytes, find_duplicate,
                  file_doc, ensure_folder, system_folder, audit, CHUNK)

router = APIRouter(prefix="/api/google")
log = logging.getLogger("google_import")
SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/photospicker.mediaitems.readonly"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
DRIVE = "https://www.googleapis.com/drive/v3/files"
PHOTOS = "https://photospicker.googleapis.com/v1"
EXPORTS = {
    "application/vnd.google-apps.document": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"),
    "application/vnd.google-apps.spreadsheet": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"),
    "application/vnd.google-apps.presentation": ("application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"),
    "application/vnd.google-apps.drawing": ("application/pdf", ".pdf"),
}


def cfg(name):
    return os.environ.get(name, "").strip()


def configured():
    return all(cfg(k) for k in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_API_KEY", "GOOGLE_PROJECT_NUMBER", "GOOGLE_REDIRECT_URI", "TOKEN_ENCRYPTION_KEY"))


def require_config():
    if not configured():
        raise HTTPException(503, "Google import is not set up yet")


def fernet():
    return Fernet(cfg("TOKEN_ENCRYPTION_KEY").encode())


@router.get("/status")
async def status(user=Depends(get_current_user)):
    connected = bool(await db.google_tokens.find_one({"user_id": user["user_id"]}))
    return {"configured": configured(), "connected": configured() and connected}


class StartIn(BaseModel):
    origin_url: str


@router.post("/oauth/start")
async def oauth_start(body: StartIn, user=Depends(get_current_user)):
    require_config()
    if not body.origin_url.startswith("https://") and not body.origin_url.startswith("http://localhost"):
        raise HTTPException(400, "Invalid origin")
    state = secrets.token_urlsafe(32)
    await db.google_oauth_states.insert_one({"state": state, "user_id": user["user_id"], "origin": body.origin_url.rstrip("/"),
                                             "expires_at": time.time() + 600})
    q = {"client_id": cfg("GOOGLE_CLIENT_ID"), "redirect_uri": cfg("GOOGLE_REDIRECT_URI"), "response_type": "code",
         "scope": SCOPES, "access_type": "offline", "prompt": "consent", "include_granted_scopes": "true", "state": state}
    return {"url": f"{AUTH_URL}?{urlencode(q)}"}


@router.get("/callback")
async def oauth_callback(state: str, code: str = "", error: str = ""):
    s = await db.google_oauth_states.find_one_and_delete({"state": state})
    if not s or s["expires_at"] < time.time():
        raise HTTPException(400, "Invalid or expired sign-in request")
    back = f"{s['origin']}/transfer"
    if error or not code:
        return RedirectResponse(f"{back}?google=denied")
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(TOKEN_URL, data={"code": code, "client_id": cfg("GOOGLE_CLIENT_ID"), "client_secret": cfg("GOOGLE_CLIENT_SECRET"),
                                          "redirect_uri": cfg("GOOGLE_REDIRECT_URI"), "grant_type": "authorization_code"})
    if r.status_code != 200:
        log.warning("google token exchange failed %s", r.status_code)
        return RedirectResponse(f"{back}?google=error")
    tok = r.json()
    old = await db.google_tokens.find_one({"user_id": s["user_id"]})
    refresh = fernet().encrypt(tok["refresh_token"].encode()).decode() if tok.get("refresh_token") else (old or {}).get("refresh_token")
    if not refresh:
        return RedirectResponse(f"{back}?google=error")
    await db.google_tokens.update_one({"user_id": s["user_id"]}, {"$set": {"user_id": s["user_id"], "refresh_token": refresh,
                                      "scopes": tok.get("scope", SCOPES), "updated_at": iso()}}, upsert=True)
    await audit(s["user_id"], "google.connected")
    return RedirectResponse(f"{back}?google=connected")


@router.post("/disconnect")
async def disconnect(user=Depends(get_current_user)):
    await db.google_tokens.delete_one({"user_id": user["user_id"]})
    return {"ok": True}


async def access_token(user_id):
    row = await db.google_tokens.find_one({"user_id": user_id})
    if not row:
        raise HTTPException(401, "Connect your Google account first")
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(TOKEN_URL, data={"client_id": cfg("GOOGLE_CLIENT_ID"), "client_secret": cfg("GOOGLE_CLIENT_SECRET"),
                                          "refresh_token": fernet().decrypt(row["refresh_token"].encode()).decode(), "grant_type": "refresh_token"})
    if r.status_code != 200:
        await db.google_tokens.delete_one({"user_id": user_id})
        raise HTTPException(401, "Google access expired. Please connect again.")
    return r.json()["access_token"]


@router.get("/picker-config")
async def picker_config(user=Depends(get_current_user)):
    require_config()
    return {"api_key": cfg("GOOGLE_API_KEY"), "app_id": cfg("GOOGLE_PROJECT_NUMBER"), "access_token": await access_token(user["user_id"])}


async def create_api_job(user, source, label, items):
    job = {"job_id": new_id("mig"), "user_id": user["user_id"], "mode": "api", "source": source, "source_label": label,
           "upload_id": None, "archive_name": f"{len(items)} selected item{'s' if len(items) != 1 else ''}", "archive_size": 0,
           "items": items, "status": "queued", "total_files": len(items), "processed": 0, "imported": 0, "duplicates": 0,
           "failed": 0, "skipped": 0, "bytes_total": 0, "bytes_done": 0, "errors": [], "dest_folder_id": None,
           "created_at": iso(), "started_at": None, "finished_at": None}
    await db.migration_jobs.insert_one(dict(job))
    from migration import start_worker, job_out
    start_worker(job["job_id"])
    await audit(user["user_id"], "migration.create", {"job_id": job["job_id"], "source": source})
    return job_out(job)


class DriveIn(BaseModel):
    file_ids: List[str] = Field(min_length=1, max_length=500)


@router.post("/drive/import")
async def drive_import(body: DriveIn, user=Depends(get_current_user)):
    require_config()
    await access_token(user["user_id"])
    return await create_api_job(user, "google_drive", "Google Drive", [{"id": i} for i in dict.fromkeys(body.file_ids)])


@router.post("/photos/session")
async def photos_session(user=Depends(get_current_user)):
    require_config()
    token = await access_token(user["user_id"])
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(f"{PHOTOS}/sessions", headers={"Authorization": f"Bearer {token}"}, json={})
    if r.status_code != 200:
        raise HTTPException(502, "Could not open Google Photos picker")
    x = r.json()
    await db.google_photo_sessions.insert_one({"session_id": x["id"], "user_id": user["user_id"], "created_at": iso()})
    return {"session_id": x["id"], "picker_uri": x["pickerUri"] + "/autoclose"}


@router.post("/photos/{session_id}/import")
async def photos_import(session_id: str, user=Depends(get_current_user)):
    require_config()
    if not await db.google_photo_sessions.find_one({"session_id": session_id, "user_id": user["user_id"]}):
        raise HTTPException(404, "Unknown picker session")
    token = await access_token(user["user_id"])
    hdr = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=30) as c:
        s = (await c.get(f"{PHOTOS}/sessions/{session_id}", headers=hdr)).json()
        if not s.get("mediaItemsSet"):
            return {"ready": False}
        items, page = [], None
        while True:
            params = {"sessionId": session_id, "pageSize": 100, **({"pageToken": page} if page else {})}
            d = (await c.get(f"{PHOTOS}/mediaItems", params=params, headers=hdr)).json()
            for m in d.get("mediaItems", []):
                mf = m.get("mediaFile", {})
                items.append({"id": m["id"], "base_url": mf.get("baseUrl"), "name": mf.get("filename") or f"{m['id']}.jpg",
                              "mime": mf.get("mimeType", ""), "taken_at": m.get("createTime")})
            page = d.get("nextPageToken")
            if not page:
                break
    await db.google_photo_sessions.delete_one({"session_id": session_id})
    if not items:
        return {"ready": True, "job": None}
    return {"ready": True, "job": await create_api_job(user, "google_photos", "Google Photos", items)}


async def stream_to_storage(c, url, headers, key, params=None):
    tmp = storage.tmp_path(f"{key.replace('/', '_')}.part")
    h, size = hashlib.sha256(), 0
    async with c.stream("GET", url, headers=headers, params=params) as r:
        if r.status_code != 200:
            raise ValueError(f"Download failed ({r.status_code})")
        with open(tmp, "wb") as out:
            async for buf in r.aiter_bytes(CHUNK):
                h.update(buf)
                size += len(buf)
                out.write(buf)
    dst = storage.path(key)
    dst.parent.mkdir(parents=True, exist_ok=True)
    os.replace(tmp, dst)
    return size, h.hexdigest()


async def fetch_item(c, job, item, hdr, key):
    if job["source"] == "google_photos":
        url = item["base_url"] + ("=dv" if item["mime"].startswith("video/") else "=d")
        size, sha = await stream_to_storage(c, url, hdr, key)
        return item["name"], size, sha, item.get("taken_at")
    meta = (await c.get(f"{DRIVE}/{item['id']}", headers=hdr, params={"fields": "name,mimeType,createdTime,size", "supportsAllDrives": "true"})).json()
    if "error" in meta:
        raise ValueError(meta["error"].get("message", "File not accessible"))
    name, mime = meta["name"], meta["mimeType"]
    if mime == "application/vnd.google-apps.folder":
        raise ValueError("Folders can't be picked directly; select the files inside")
    if mime in EXPORTS:
        out_mime, ext = EXPORTS[mime]
        size, sha = await stream_to_storage(c, f"{DRIVE}/{item['id']}/export", hdr, key, {"mimeType": out_mime})
        return name + ext, size, sha, meta.get("createdTime")
    if mime.startswith("application/vnd.google-apps"):
        raise ValueError("This Google file type can't be exported")
    size, sha = await stream_to_storage(c, f"{DRIVE}/{item['id']}", hdr, key, {"alt": "media", "supportsAllDrives": "true"})
    return name, size, sha, meta.get("createdTime")


async def run_api_job(job_id):
    job = await db.migration_jobs.find_one({"job_id": job_id}, {"_id": 0})
    uid = job["user_id"]
    try:
        token = await access_token(uid)
    except HTTPException as e:
        return await db.migration_jobs.update_one({"job_id": job_id}, {"$set": {"status": "failed", "finished_at": iso()},
                                                  "$push": {"errors": {"file": "-", "error": e.detail}}})
    root = await system_folder(uid, "google")
    sub = await ensure_folder(uid, f"{job['source_label']} {datetime.fromisoformat(job['created_at']).strftime('%d %b %Y %H:%M')}", root["folder_id"])
    await db.migration_jobs.update_one({"job_id": job_id}, {"$set": {"status": "running", "dest_folder_id": sub["folder_id"],
                                                                     "started_at": job.get("started_at") or iso()}})
    user = await db.users.find_one({"user_id": uid}, {"_id": 0})
    hdr = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as c:
        for idx, item in enumerate(job["items"]):
            if idx < job.get("processed", 0):
                continue
            while (st := (await db.migration_jobs.find_one({"job_id": job_id}, {"status": 1}))["status"]) == "paused":
                await asyncio.sleep(1)
            if st == "cancelled":
                return await db.migration_jobs.update_one({"job_id": job_id}, {"$set": {"finished_at": iso()}})
            inc = {"processed": 1}
            key = f"{uid}/{new_id('file')}"
            try:
                if await usage_bytes(uid) >= await quota_bytes(user):
                    raise ValueError("Storage full. Upgrade your plan and retry.")
                name, size, sha, taken = await fetch_item(c, job, item, hdr, key)
                inc["bytes_done"] = size
                if await find_duplicate(uid, sha):
                    storage.delete(key)
                    inc["duplicates"] = 1
                else:
                    await db.files.insert_one(file_doc(uid, sub["folder_id"], name, size, sha, key, source=job["source"], taken_at=taken))
                    inc["imported"] = 1
            except Exception as e:
                storage.delete(key)
                inc["failed"] = 1
                await db.migration_jobs.update_one({"job_id": job_id}, {"$push": {"errors": {"file": item.get("name") or item["id"], "error": str(e)[:200]}}})
            await db.migration_jobs.update_one({"job_id": job_id}, {"$inc": inc})
    await db.migration_jobs.update_one({"job_id": job_id}, {"$set": {"status": "completed", "finished_at": iso()}})
    await audit(uid, "migration.completed", {"job_id": job_id})
