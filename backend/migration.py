import asyncio
import json
import logging
import zipfile
from pathlib import PurePosixPath
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, Field
from core import (db, storage, iso, new_id, get_current_user, ensure_quota, usage_bytes, quota_bytes,
                  find_duplicate, file_doc, ensure_folder, system_folder, audit)

router = APIRouter(prefix="/api")
log = logging.getLogger("migration")
SOURCES = {"google_takeout": "Google Takeout", "icloud": "iCloud", "dropbox": "Dropbox",
           "onedrive": "OneDrive", "azure": "Azure Blob"}
MAX_UPLOAD = 50 * 1024 ** 3
MAX_RATIO = 200
TASKS = {}


class UploadInit(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    size: int = Field(gt=0, le=MAX_UPLOAD)


@router.post("/uploads/init")
async def upload_init(body: UploadInit, user=Depends(get_current_user)):
    if not body.filename.lower().endswith(".zip"):
        raise HTTPException(400, "Please choose a .zip archive")
    await ensure_quota(user, body.size)
    up = {"upload_id": new_id("upl"), "user_id": user["user_id"], "filename": body.filename, "size": body.size,
          "received": 0, "status": "uploading", "created_at": iso()}
    await db.uploads.insert_one(dict(up))
    up.pop("user_id")
    return up


async def own_upload(uid, upload_id):
    up = await db.uploads.find_one({"upload_id": upload_id, "user_id": uid}, {"_id": 0})
    if not up:
        raise HTTPException(404, "Upload not found")
    return up


@router.get("/uploads/{upload_id}")
async def upload_status(upload_id: str, user=Depends(get_current_user)):
    return await own_upload(user["user_id"], upload_id)


@router.put("/uploads/{upload_id}/chunk")
async def upload_chunk(upload_id: str, offset: int, request: Request, user=Depends(get_current_user)):
    up = await own_upload(user["user_id"], upload_id)
    if up["status"] != "uploading":
        raise HTTPException(400, "Upload already completed")
    if offset != up["received"]:
        raise HTTPException(409, f"Expected offset {up['received']}")
    data = await request.body()
    if up["received"] + len(data) > up["size"]:
        raise HTTPException(400, "Chunk exceeds declared size")
    with open(storage.tmp_path(f"{upload_id}.zip"), "ab") as f:
        f.write(data)
    received = up["received"] + len(data)
    await db.uploads.update_one({"upload_id": upload_id}, {"$set": {"received": received,
                                "status": "complete" if received == up["size"] else "uploading"}})
    return {"received": received, "complete": received == up["size"]}


class JobIn(BaseModel):
    source: str
    upload_id: str


def job_out(j):
    j = {k: v for k, v in j.items() if k not in ("_id", "user_id")}
    j["errors"] = j.get("errors", [])[:200]
    return j


@router.post("/migrations")
async def create_job(body: JobIn, user=Depends(get_current_user)):
    if body.source not in SOURCES:
        raise HTTPException(400, "Unknown source")
    up = await own_upload(user["user_id"], body.upload_id)
    if up["status"] != "complete":
        raise HTTPException(400, "Archive upload is not complete")
    job = {"job_id": new_id("mig"), "user_id": user["user_id"], "source": body.source, "source_label": SOURCES[body.source],
           "upload_id": body.upload_id, "archive_name": up["filename"], "archive_size": up["size"], "status": "queued",
           "total_files": 0, "processed": 0, "imported": 0, "duplicates": 0, "failed": 0, "skipped": 0,
           "bytes_total": 0, "bytes_done": 0, "errors": [], "dest_folder_id": None, "created_at": iso(),
           "started_at": None, "finished_at": None}
    await db.migration_jobs.insert_one(dict(job))
    await db.uploads.update_one({"upload_id": body.upload_id}, {"$set": {"status": "used"}})
    start_worker(job["job_id"])
    await audit(user["user_id"], "migration.create", {"job_id": job["job_id"], "source": body.source})
    return job_out(job)


@router.get("/migrations")
async def list_jobs(user=Depends(get_current_user)):
    rows = await db.migration_jobs.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return [job_out(r) for r in rows]


@router.get("/migrations/{job_id}")
async def get_job(job_id: str, user=Depends(get_current_user)):
    j = await db.migration_jobs.find_one({"job_id": job_id, "user_id": user["user_id"]}, {"_id": 0})
    if not j:
        raise HTTPException(404, "Job not found")
    return job_out(j)


@router.post("/migrations/{job_id}/{action}")
async def job_action(job_id: str, action: str, user=Depends(get_current_user)):
    j = await get_job(job_id, user)
    st = j["status"]
    rules = {"pause": ({"running", "queued"}, "paused"), "resume": ({"paused"}, "running"),
             "cancel": ({"running", "queued", "paused"}, "cancelled"), "retry": ({"failed", "cancelled", "completed"}, "queued")}
    if action not in rules or st not in rules[action][0]:
        raise HTTPException(400, f"Cannot {action} a {st} job")
    upd = {"status": rules[action][1]}
    if action == "retry":
        if not storage.tmp_path(f"{j['upload_id']}.zip").exists():
            raise HTTPException(400, "Archive no longer available. Please upload it again.")
        upd.update({"processed": 0, "errors": [], "failed": 0, "finished_at": None})
    await db.migration_jobs.update_one({"job_id": job_id}, {"$set": upd})
    if action in ("retry", "resume") and job_id not in TASKS:
        start_worker(job_id)
    return await get_job(job_id, user)


def start_worker(job_id):
    t = asyncio.create_task(run_job(job_id))
    TASKS[job_id] = t
    t.add_done_callback(lambda _: TASKS.pop(job_id, None))


def safe_parts(name):
    p = PurePosixPath(name.replace("\\", "/"))
    if p.is_absolute() or any(x in ("..", "") for x in p.parts) or ":" in p.parts[0]:
        return None
    return p.parts


def takeout_times(zf, infos):
    times = {}
    for i in infos:
        if i.filename.endswith(".json") and i.file_size < 1024 * 1024:
            try:
                meta = json.loads(zf.read(i))
                ts = (meta.get("photoTakenTime") or {}).get("timestamp")
                if ts and meta.get("title"):
                    folder = i.filename.rsplit("/", 1)[0] if "/" in i.filename else ""
                    times[f"{folder}/{meta['title']}"] = datetime.fromtimestamp(int(ts), timezone.utc).isoformat()
            except Exception:
                continue
    return times


async def fail(job_id, msg):
    await db.migration_jobs.update_one({"job_id": job_id}, {"$set": {"status": "failed", "finished_at": iso()},
                                                            "$push": {"errors": {"file": "-", "error": msg}}})


async def dest_folder(job):
    uid = job["user_id"]
    if job["source"] == "google_takeout":
        root = await system_folder(uid, "google")
    else:
        root = await ensure_folder(uid, f"{job['source_label']} Backup", None)
    stamp = datetime.fromisoformat(job["created_at"]).strftime("%d %b %Y %H:%M")
    return await ensure_folder(uid, f"Import {stamp}", root["folder_id"])


def is_sidecar(name):
    return name.endswith(".json") and "takeout" in name.lower() or name.lower().endswith((".ds_store", "thumbs.db"))


async def run_job(job_id):
    job = await db.migration_jobs.find_one({"job_id": job_id}, {"_id": 0})
    uid = job["user_id"]
    zpath = storage.tmp_path(f"{job['upload_id']}.zip")
    try:
        zf = zipfile.ZipFile(zpath)
    except (zipfile.BadZipFile, FileNotFoundError):
        return await fail(job_id, "The archive is damaged or not a valid ZIP file")
    with zf:
        infos = [i for i in zf.infolist() if not i.is_dir() and not i.filename.startswith("__MACOSX/")]
        times = takeout_times(zf, infos) if job["source"] == "google_takeout" else {}
        media = [i for i in infos if not (job["source"] == "google_takeout" and i.filename.endswith(".json")) and not is_sidecar(i.filename)]
        total_bytes = sum(i.file_size for i in media)
        user = await db.users.find_one({"user_id": uid}, {"_id": 0})
        free = await quota_bytes(user) - await usage_bytes(uid)
        if total_bytes > free:
            return await fail(job_id, "Not enough storage for this archive. Upgrade your plan and retry.")
        folder = await dest_folder(job)
        await db.migration_jobs.update_one({"job_id": job_id}, {"$set": {
            "status": "running", "total_files": len(media), "bytes_total": total_bytes,
            "dest_folder_id": folder["folder_id"], "started_at": job.get("started_at") or iso()}})
        cache = {(): folder["folder_id"]}
        start = job.get("processed", 0)
        for idx, info in enumerate(media):
            if idx < start:
                continue
            while True:
                st = (await db.migration_jobs.find_one({"job_id": job_id}, {"status": 1}))["status"]
                if st != "paused":
                    break
                await asyncio.sleep(1)
            if st == "cancelled":
                return await db.migration_jobs.update_one({"job_id": job_id}, {"$set": {"finished_at": iso()}})
            inc = {"processed": 1}
            parts = safe_parts(info.filename)
            try:
                if not parts:
                    raise ValueError("Unsafe file path skipped")
                if info.compress_size and info.file_size / info.compress_size > MAX_RATIO:
                    raise ValueError("Suspicious compression ratio skipped")
                parent = folder["folder_id"]
                for n in range(1, len(parts)):
                    k = parts[:n]
                    if k not in cache:
                        cache[k] = (await ensure_folder(uid, parts[n - 1], cache[parts[:n - 1]]))["folder_id"]
                    parent = cache[k]
                fid = new_id("file")
                key = f"{uid}/{fid}"

                def extract():
                    with zf.open(info) as src:
                        return storage.write_stream(key, src)
                size, sha = await asyncio.to_thread(extract)
                if size != info.file_size:
                    storage.delete(key)
                    raise ValueError("Size check failed")
                if await find_duplicate(uid, sha):
                    storage.delete(key)
                    inc["duplicates"] = 1
                else:
                    folder_path = info.filename.rsplit("/", 1)[0] if "/" in info.filename else ""
                    taken = times.get(f"{folder_path}/{parts[-1]}")
                    await db.files.insert_one(file_doc(uid, parent, parts[-1], size, sha, key, source=job["source"], taken_at=taken))
                    inc["imported"] = 1
            except Exception as e:
                inc["failed"] = 1
                await db.migration_jobs.update_one({"job_id": job_id}, {"$push": {"errors": {"file": info.filename, "error": str(e)[:200]}}})
            inc["bytes_done"] = info.file_size
            await db.migration_jobs.update_one({"job_id": job_id}, {"$inc": inc})
    await db.migration_jobs.update_one({"job_id": job_id}, {"$set": {"status": "completed", "finished_at": iso()}})
    await audit(uid, "migration.completed", {"job_id": job_id})


async def resume_pending():
    async for j in db.migration_jobs.find({"status": {"$in": ["queued", "running"]}}, {"job_id": 1}):
        start_worker(j["job_id"])
