import re
import secrets
from datetime import timedelta
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from notifications import schedule_storage_check
from core import (db, storage, now, iso, new_id, get_current_user, ensure_quota, usage_bytes, quota_bytes,
                  get_plan, find_duplicate, file_doc, public_file, create_default_folders, audit, file_kind, system_folder)

router = APIRouter(prefix="/api")
BIN_DAYS = 30
PROJ = {"_id": 0, "storage_key": 0, "user_id": 0}


async def own_folder(user_id, folder_id, allow_deleted=False):
    q = {"user_id": user_id, "folder_id": folder_id}
    if not allow_deleted:
        q["deleted_at"] = None
    f = await db.folders.find_one(q, {"_id": 0})
    if not f:
        raise HTTPException(404, "Folder not found")
    return f


async def own_file(user_id, file_id, allow_deleted=False):
    q = {"user_id": user_id, "file_id": file_id}
    if not allow_deleted:
        q["deleted_at"] = None
    f = await db.files.find_one(q, {"_id": 0})
    if not f:
        raise HTTPException(404, "File not found")
    return f


async def breadcrumbs(user_id, folder):
    crumbs = []
    while folder:
        crumbs.insert(0, {"folder_id": folder["folder_id"], "name": folder["name"]})
        folder = await db.folders.find_one({"user_id": user_id, "folder_id": folder["parent_id"]}, {"_id": 0}) if folder.get("parent_id") else None
    return crumbs


async def descendants(user_id, folder_id):
    ids, frontier = [folder_id], [folder_id]
    while frontier:
        kids = await db.folders.find({"user_id": user_id, "parent_id": {"$in": frontier}}, {"folder_id": 1}).to_list(5000)
        frontier = [k["folder_id"] for k in kids]
        ids += frontier
    return ids


@router.get("/storage")
async def storage_info(user=Depends(get_current_user)):
    uid = user["user_id"]
    rows = await db.files.aggregate([{"$match": {"user_id": uid}}, {"$group": {"_id": "$kind", "s": {"$sum": "$size"}, "n": {"$sum": 1}}}]).to_list(20)
    used, quota = await usage_bytes(uid), await quota_bytes(user)
    return {"used": used, "quota": quota, "available": max(quota - used, 0),
            "breakdown": {r["_id"]: {"bytes": r["s"], "count": r["n"]} for r in rows},
            "plan": await get_plan(user.get("plan_id", "free"))}


@router.get("/home")
async def home(user=Depends(get_current_user)):
    uid = user["user_id"]
    await create_default_folders(uid)
    folders = await db.folders.find({"user_id": uid, "system_key": {"$ne": None}}, {"_id": 0, "user_id": 0}).to_list(20)
    for f in folders:
        ids = await descendants(uid, f["folder_id"])
        f["count"] = await db.files.count_documents({"user_id": uid, "folder_id": {"$in": ids}, "deleted_at": None})
    order = ["photos", "documents", "videos", "google", "family", "harddisk"]
    folders.sort(key=lambda f: order.index(f["system_key"]) if f["system_key"] in order else 99)
    photos = await db.files.find({"user_id": uid, "deleted_at": None, "kind": "image"}, PROJ).sort("created_at", -1).to_list(12)
    recent = await db.files.find({"user_id": uid, "deleted_at": None}, PROJ).sort("created_at", -1).to_list(8)
    return {"folders": folders, "recent_photos": photos, "recent_files": recent, "storage": await storage_info(user)}


@router.get("/browse")
async def browse(folder_id: Optional[str] = None, q: str = "", kind: str = "all", sort: str = "name",
                 order: str = "asc", user=Depends(get_current_user)):
    uid = user["user_id"]
    await create_default_folders(uid)
    fq, flq = {"user_id": uid, "deleted_at": None}, {"user_id": uid, "deleted_at": None}
    folder, crumbs = None, []
    if q:
        rx = {"$regex": re.escape(q), "$options": "i"}
        fq["name"], flq["name"] = rx, rx
    else:
        fq["folder_id"], flq["parent_id"] = folder_id, folder_id
        if folder_id:
            folder = await own_folder(uid, folder_id)
            crumbs = await breadcrumbs(uid, folder)
    if kind != "all":
        fq["kind"] = kind
    key = {"name": "name", "date": "created_at", "size": "size"}.get(sort, "name")
    direction = 1 if order == "asc" else -1
    files = await db.files.find(fq, PROJ).sort(key, direction).to_list(2000)
    folders = [] if kind != "all" else await db.folders.find(flq, {"_id": 0, "user_id": 0}).sort("name" if key != "created_at" else key, direction).to_list(1000)
    return {"folder": folder, "breadcrumbs": crumbs, "folders": folders, "files": files}


@router.get("/folders/all")
async def all_folders(user=Depends(get_current_user)):
    rows = await db.folders.find({"user_id": user["user_id"], "deleted_at": None}, {"_id": 0, "user_id": 0}).to_list(5000)
    by_id = {r["folder_id"]: r for r in rows}

    def path(r):
        parts, cur = [], r
        while cur:
            parts.insert(0, cur["name"])
            cur = by_id.get(cur.get("parent_id"))
        return " / ".join(parts)
    out = [{"folder_id": r["folder_id"], "path": path(r)} for r in rows]
    return sorted(out, key=lambda r: r["path"].lower())


class FolderIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    parent_id: Optional[str] = None


class FolderPatch(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    parent_id: Optional[str] = None
    move: bool = False


@router.post("/folders")
async def create_folder(body: FolderIn, user=Depends(get_current_user)):
    if body.parent_id:
        await own_folder(user["user_id"], body.parent_id)
    f = {"folder_id": new_id("fld"), "user_id": user["user_id"], "name": body.name.strip(), "parent_id": body.parent_id,
         "system_key": None, "deleted_at": None, "created_at": iso()}
    await db.folders.insert_one(dict(f))
    f.pop("user_id")
    return f


@router.patch("/folders/{folder_id}")
async def update_folder(folder_id: str, body: FolderPatch, user=Depends(get_current_user)):
    uid = user["user_id"]
    f = await own_folder(uid, folder_id)
    upd = {}
    if body.name:
        if f.get("system_key"):
            raise HTTPException(400, "Default folders cannot be renamed")
        upd["name"] = body.name.strip()
    if body.move:
        if f.get("system_key"):
            raise HTTPException(400, "Default folders cannot be moved")
        if body.parent_id:
            await own_folder(uid, body.parent_id)
            if body.parent_id in await descendants(uid, folder_id):
                raise HTTPException(400, "Cannot move a folder inside itself")
        upd["parent_id"] = body.parent_id
    if upd:
        await db.folders.update_one({"folder_id": folder_id}, {"$set": upd})
    return {"ok": True}


@router.delete("/folders/{folder_id}")
async def delete_folder(folder_id: str, user=Depends(get_current_user)):
    uid = user["user_id"]
    f = await own_folder(uid, folder_id)
    if f.get("system_key"):
        raise HTTPException(400, "Default folders cannot be deleted")
    ids, ts = await descendants(uid, folder_id), iso()
    await db.folders.update_many({"user_id": uid, "folder_id": {"$in": ids}, "deleted_at": None}, {"$set": {"deleted_at": ts, "deleted_with": folder_id}})
    await db.files.update_many({"user_id": uid, "folder_id": {"$in": ids}, "deleted_at": None}, {"$set": {"deleted_at": ts, "deleted_with": folder_id}})
    await db.folders.update_one({"folder_id": folder_id}, {"$set": {"bin_root": True}})
    return {"ok": True}


@router.post("/files/upload")
async def upload(files: List[UploadFile] = File(...), folder_id: Optional[str] = Form(None),
                 auto: bool = Form(False), user=Depends(get_current_user)):
    uid = user["user_id"]
    if folder_id:
        await own_folder(uid, folder_id)
    results = []
    for up in files:
        target = folder_id
        if auto and not folder_id:
            k = file_kind(up.filename or "", up.content_type)
            target = (await system_folder(uid, {"image": "photos", "video": "videos"}.get(k, "documents")))["folder_id"]
        await ensure_quota(user, up.size or 0)
        fid = new_id("file")
        key = f"{uid}/{fid}"
        size, sha = storage.write_stream(key, up.file)
        dup = await find_duplicate(uid, sha)
        if dup:
            storage.delete(key)
            results.append({"name": up.filename, "status": "duplicate", "existing": public_file(dup)})
            continue
        doc = file_doc(uid, target, up.filename or "untitled", size, sha, key)
        await db.files.insert_one(dict(doc))
        results.append({"name": up.filename, "status": "uploaded", "file": public_file(doc)})
    await audit(uid, "files.upload", {"count": len(files)})
    schedule_storage_check(uid)
    return {"results": results}


@router.get("/files/recent")
async def recent(user=Depends(get_current_user)):
    return await db.files.find({"user_id": user["user_id"], "deleted_at": None}, PROJ).sort("created_at", -1).to_list(30)


@router.get("/files/{file_id}/content")
async def content(file_id: str, download: int = 0, user=Depends(get_current_user)):
    f = await own_file(user["user_id"], file_id)
    return FileResponse(storage.path(f["storage_key"]), media_type=f["mime"], filename=f["name"],
                        content_disposition_type="attachment" if download else "inline")


class FilePatch(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    folder_id: Optional[str] = None
    move: bool = False
    favorite: Optional[bool] = None


@router.patch("/files/{file_id}")
async def update_file(file_id: str, body: FilePatch, user=Depends(get_current_user)):
    uid = user["user_id"]
    await own_file(uid, file_id)
    upd = {}
    if body.name:
        upd["name"] = body.name.strip()
    if body.move:
        if body.folder_id:
            await own_folder(uid, body.folder_id)
        upd["folder_id"] = body.folder_id
    if body.favorite is not None:
        upd["favorite"] = body.favorite
    if upd:
        await db.files.update_one({"file_id": file_id}, {"$set": upd})
    return public_file(await own_file(uid, file_id))


class CopyIn(BaseModel):
    folder_id: Optional[str] = None


@router.post("/files/{file_id}/copy")
async def copy_file(file_id: str, body: CopyIn, user=Depends(get_current_user)):
    uid = user["user_id"]
    f = await own_file(uid, file_id)
    if body.folder_id:
        await own_folder(uid, body.folder_id)
    await ensure_quota(user, f["size"])
    fid = new_id("file")
    key = f"{uid}/{fid}"
    storage.copy(f["storage_key"], key)
    name = f["name"] if body.folder_id != f["folder_id"] else f"Copy of {f['name']}"
    doc = file_doc(uid, body.folder_id, name, f["size"], f["sha256"], key, source="copy", taken_at=f.get("taken_at"))
    await db.files.insert_one(dict(doc))
    return public_file(doc)


@router.delete("/files/{file_id}")
async def delete_file(file_id: str, user=Depends(get_current_user)):
    await own_file(user["user_id"], file_id)
    await db.files.update_one({"file_id": file_id}, {"$set": {"deleted_at": iso(), "deleted_with": None}})
    return {"ok": True}


class ShareIn(BaseModel):
    days: int = Field(7, ge=1, le=90)


@router.post("/files/{file_id}/share")
async def share(file_id: str, body: ShareIn, user=Depends(get_current_user)):
    f = await own_file(user["user_id"], file_id)
    token = secrets.token_urlsafe(18)
    await db.shares.insert_one({"token": token, "file_id": f["file_id"], "user_id": user["user_id"],
                                "expires_at": iso(now() + timedelta(days=body.days)), "created_at": iso()})
    return {"token": token, "expires_at": iso(now() + timedelta(days=body.days))}


async def shared_file(token):
    s = await db.shares.find_one({"token": token}, {"_id": 0})
    if not s or s["expires_at"] < iso():
        raise HTTPException(404, "This link has expired or does not exist")
    f = await db.files.find_one({"file_id": s["file_id"], "deleted_at": None}, {"_id": 0})
    if not f:
        raise HTTPException(404, "File no longer available")
    return s, f


@router.get("/share/{token}")
async def share_meta(token: str):
    s, f = await shared_file(token)
    owner = await db.users.find_one({"user_id": f["user_id"]}, {"name": 1})
    return {"file": public_file(f), "owner": owner.get("name") if owner else "", "expires_at": s["expires_at"]}


@router.get("/share/{token}/content")
async def share_content(token: str, download: int = 0):
    _, f = await shared_file(token)
    return FileResponse(storage.path(f["storage_key"]), media_type=f["mime"], filename=f["name"],
                        content_disposition_type="attachment" if download else "inline")


@router.get("/photos")
async def photos(kind: str = "all", user=Depends(get_current_user)):
    q = {"user_id": user["user_id"], "deleted_at": None}
    if kind == "favorites":
        q["favorite"], q["kind"] = True, {"$in": ["image", "video"]}
    elif kind in ("image", "video"):
        q["kind"] = kind
    else:
        q["kind"] = {"$in": ["image", "video"]}
    return await db.files.find(q, PROJ).sort("taken_at", -1).to_list(5000)


async def purge_file(f):
    storage.delete(f["storage_key"])
    await db.files.delete_one({"file_id": f["file_id"]})


async def purge_old(uid):
    cutoff = iso(now() - timedelta(days=BIN_DAYS))
    async for f in db.files.find({"user_id": uid, "deleted_at": {"$ne": None, "$lt": cutoff}}, {"_id": 0}):
        await purge_file(f)
    await db.folders.delete_many({"user_id": uid, "deleted_at": {"$ne": None, "$lt": cutoff}})


@router.get("/bin")
async def bin_list(user=Depends(get_current_user)):
    uid = user["user_id"]
    await purge_old(uid)
    files = await db.files.find({"user_id": uid, "deleted_at": {"$ne": None}, "deleted_with": None}, PROJ).sort("deleted_at", -1).to_list(2000)
    folders = await db.folders.find({"user_id": uid, "deleted_at": {"$ne": None}, "bin_root": True}, {"_id": 0, "user_id": 0}).sort("deleted_at", -1).to_list(500)
    return {"files": files, "folders": folders, "retention_days": BIN_DAYS}


class BinItem(BaseModel):
    kind: str
    id: str


@router.post("/bin/restore")
async def bin_restore(body: BinItem, user=Depends(get_current_user)):
    uid = user["user_id"]
    if body.kind == "file":
        f = await own_file(uid, body.id, allow_deleted=True)
        parent_ok = not f["folder_id"] or await db.folders.find_one({"folder_id": f["folder_id"], "deleted_at": None})
        await db.files.update_one({"file_id": body.id}, {"$set": {"deleted_at": None, "folder_id": f["folder_id"] if parent_ok else None}})
    else:
        f = await own_folder(uid, body.id, allow_deleted=True)
        parent_ok = not f["parent_id"] or await db.folders.find_one({"folder_id": f["parent_id"], "deleted_at": None})
        await db.folders.update_many({"user_id": uid, "deleted_with": body.id}, {"$set": {"deleted_at": None, "deleted_with": None}})
        await db.files.update_many({"user_id": uid, "deleted_with": body.id}, {"$set": {"deleted_at": None, "deleted_with": None}})
        await db.folders.update_one({"folder_id": body.id}, {"$set": {"bin_root": False, "parent_id": f["parent_id"] if parent_ok else None}})
    return {"ok": True}


async def purge_item(uid, kind, item_id):
    if kind == "file":
        await purge_file(await own_file(uid, item_id, allow_deleted=True))
        return
    async for f in db.files.find({"user_id": uid, "deleted_with": item_id}, {"_id": 0}):
        await purge_file(f)
    await db.folders.delete_many({"user_id": uid, "deleted_with": item_id})


@router.delete("/bin/{kind}/{item_id}")
async def bin_delete(kind: str, item_id: str, user=Depends(get_current_user)):
    await purge_item(user["user_id"], kind, item_id)
    return {"ok": True}


@router.delete("/bin")
async def bin_empty(user=Depends(get_current_user)):
    uid = user["user_id"]
    async for f in db.files.find({"user_id": uid, "deleted_at": {"$ne": None}}, {"_id": 0}):
        await purge_file(f)
    await db.folders.delete_many({"user_id": uid, "deleted_at": {"$ne": None}})
    return {"ok": True}
