import os
import uuid
import hashlib
import shutil
import mimetypes
from pathlib import Path
from datetime import datetime, timezone
from dotenv import load_dotenv
from fastapi import HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

GB = 1024 ** 3
CHUNK = 1024 * 1024
SYSTEM_FOLDERS = [
    ("photos", "My Photos"), ("documents", "My Documents"), ("videos", "My Videos"),
    ("google", "Google Backup"), ("family", "Family Files"), ("harddisk", "My Hard Disk"),
]


def now():
    return datetime.now(timezone.utc)


def iso(dt=None):
    return (dt or now()).isoformat()


def new_id(prefix):
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


class LocalObjectStorage:
    """Disk-backed object store; swap for Extreme Compute / S3 adapter later."""

    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / "_tmp").mkdir(exist_ok=True)

    def path(self, key):
        return self.root / key

    def tmp_path(self, name):
        return self.root / "_tmp" / name

    def write_stream(self, key, src):
        p = self.path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        h, size = hashlib.sha256(), 0
        with open(p, "wb") as out:
            while True:
                buf = src.read(CHUNK)
                if not buf:
                    break
                h.update(buf)
                size += len(buf)
                out.write(buf)
        return size, h.hexdigest()

    def copy(self, src_key, dst_key):
        dst = self.path(dst_key)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(self.path(src_key), dst)

    def delete(self, key):
        p = self.path(key)
        if p.exists():
            p.unlink()


storage = LocalObjectStorage(os.environ["STORAGE_ROOT"])


def file_kind(name, mime):
    mime = mime or ""
    ext = name.lower().rsplit(".", 1)[-1] if "." in name else ""
    if mime.startswith("image/") or ext in ("heic", "heif", "jpg", "jpeg", "png", "gif", "webp"):
        return "image"
    if mime.startswith("video/") or ext in ("mp4", "mov", "mkv", "webm", "avi"):
        return "video"
    if mime.startswith("audio/"):
        return "audio"
    if ext in ("zip", "rar", "7z", "tar", "gz"):
        return "archive"
    if ext in ("pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "md", "odt"):
        return "document"
    return "other"


def guess_mime(name):
    m = mimetypes.guess_type(name)[0]
    if not m and name.lower().endswith((".heic", ".heif")):
        m = "image/heic"
    return m or "application/octet-stream"


async def audit(user_id, action, detail=None):
    await db.audit_logs.insert_one({"log_id": new_id("log"), "user_id": user_id, "action": action,
                                    "detail": detail or {}, "created_at": iso()})


async def get_current_user(request: Request):
    token = request.cookies.get("session_token")
    auth = request.headers.get("Authorization", "")
    if not token and auth.startswith("Bearer "):
        token = auth[7:]
    if not token:
        raise HTTPException(401, "Not authenticated")
    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not sess:
        raise HTTPException(401, "Session not found")
    exp = datetime.fromisoformat(sess["expires_at"]) if isinstance(sess["expires_at"], str) else sess["expires_at"]
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < now():
        raise HTTPException(401, "Session expired")
    user = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(401, "User not found")
    if user.get("status") == "suspended":
        raise HTTPException(403, "Account suspended")
    user["_session_id"] = sess["session_id"]
    return user


async def require_admin(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    return user


async def usage_bytes(user_id):
    rows = await db.files.aggregate([{"$match": {"user_id": user_id}},
                                     {"$group": {"_id": None, "s": {"$sum": "$size"}}}]).to_list(1)
    return rows[0]["s"] if rows else 0


async def get_plan(plan_id):
    return await db.plans.find_one({"plan_id": plan_id}, {"_id": 0}) or await db.plans.find_one({"plan_id": "free"}, {"_id": 0})


async def quota_bytes(user):
    plan = await get_plan(user.get("plan_id", "free"))
    return int(plan["storage_gb"] * GB)


async def ensure_quota(user, extra):
    if await usage_bytes(user["user_id"]) + extra > await quota_bytes(user):
        raise HTTPException(413, "Storage full. Upgrade your plan to add more files.")


async def create_default_folders(user_id):
    for key, name in SYSTEM_FOLDERS:
        if not await db.folders.find_one({"user_id": user_id, "system_key": key}):
            await db.folders.insert_one({"folder_id": new_id("fld"), "user_id": user_id, "name": name,
                                         "parent_id": None, "system_key": key, "deleted_at": None,
                                         "created_at": iso()})


async def system_folder(user_id, key):
    await create_default_folders(user_id)
    return await db.folders.find_one({"user_id": user_id, "system_key": key}, {"_id": 0})


async def ensure_folder(user_id, name, parent_id):
    f = await db.folders.find_one({"user_id": user_id, "name": name, "parent_id": parent_id, "deleted_at": None}, {"_id": 0})
    if f:
        return f
    f = {"folder_id": new_id("fld"), "user_id": user_id, "name": name, "parent_id": parent_id,
         "system_key": None, "deleted_at": None, "created_at": iso()}
    await db.folders.insert_one(dict(f))
    return f


async def find_duplicate(user_id, sha):
    return await db.files.find_one({"user_id": user_id, "sha256": sha, "deleted_at": None}, {"_id": 0})


def file_doc(user_id, folder_id, name, size, sha, key, source="upload", taken_at=None):
    mime = guess_mime(name)
    return {"file_id": key.split("/")[-1], "user_id": user_id, "folder_id": folder_id, "name": name,
            "size": size, "mime": mime, "kind": file_kind(name, mime), "sha256": sha, "storage_key": key,
            "favorite": False, "source": source, "deleted_at": None, "created_at": iso(),
            "taken_at": taken_at or iso()}


def public_file(f):
    return {k: v for k, v in f.items() if k not in ("_id", "storage_key", "user_id")}
