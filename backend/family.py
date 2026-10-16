from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr, Field
import os
from emailer import send_email, invite_email
from notifications import schedule_storage_check
from core import (db, storage, iso, new_id, get_current_user, ensure_quota, get_plan, find_duplicate, file_doc,
                  public_file, system_folder, audit)

router = APIRouter(prefix="/api/family")
PROJ = {"_id": 0, "storage_key": 0, "user_id": 0}
ACCESS = ("viewer", "editor")


class InviteIn(BaseModel):
    email: EmailStr
    access: str = "editor"


class AccessIn(BaseModel):
    access: str


async def seats(owner):
    plan = await get_plan(owner.get("plan_id", "free"))
    used = await db.family_members.count_documents({"owner_id": owner["user_id"], "status": {"$in": ["pending", "active"]}})
    return plan, used, max(plan.get("members", 1) - 1, 0)


@router.get("")
async def overview(user=Depends(get_current_user)):
    plan, used, total = await seats(user)
    members = await db.family_members.find({"owner_id": user["user_id"], "status": {"$in": ["pending", "active"]}}, {"_id": 0}).to_list(50)
    mine = await db.family_members.find({"$or": [{"user_id": user["user_id"], "status": "active"}, {"email": user["email"], "status": "pending"}]}, {"_id": 0}).to_list(50)
    owners = {u["user_id"]: u for u in await db.users.find({"user_id": {"$in": [m["owner_id"] for m in mine]}}, {"_id": 0, "user_id": 1, "name": 1, "email": 1}).to_list(50)}
    for m in mine:
        o = owners.get(m["owner_id"], {})
        m["owner_name"], m["owner_email"] = o.get("name", ""), o.get("email", "")
    fam = await system_folder(user["user_id"], "family")
    return {"plan": plan, "seats_total": total, "seats_used": used, "members": members,
            "family_folder_id": fam["folder_id"], "memberships": [m for m in mine if m["status"] == "active"],
            "invitations": [m for m in mine if m["status"] == "pending"]}


@router.post("/invite")
async def invite(body: InviteIn, user=Depends(get_current_user)):
    plan, used, total = await seats(user)
    if total == 0:
        raise HTTPException(400, "Upgrade to the Family or Business plan to invite members")
    if used >= total:
        raise HTTPException(400, f"All {total} member seats are in use")
    email = body.email.lower()
    if email == user["email"]:
        raise HTTPException(400, "You are already the owner")
    if body.access not in ACCESS:
        raise HTTPException(400, "Invalid access level")
    if await db.family_members.find_one({"owner_id": user["user_id"], "email": email, "status": {"$in": ["pending", "active"]}}):
        raise HTTPException(409, "This person is already invited")
    m = {"member_id": new_id("fam"), "owner_id": user["user_id"], "email": email, "user_id": None,
         "status": "pending", "access": body.access, "invited_at": iso(), "joined_at": None}
    await db.family_members.insert_one(dict(m))
    await audit(user["user_id"], "family.invite", {"email": email})
    subject, html = invite_email(user["name"], plan["name"], f"{os.environ['APP_URL'].rstrip('/')}/family?join={m['member_id']}")
    m["email_sent"] = bool(await send_email(to=email, subject=subject, html=html))
    await db.family_members.update_one({"member_id": m["member_id"]}, {"$set": {"email_sent": m["email_sent"]}})
    return m


@router.post("/members/{member_id}/resend")
async def resend(member_id: str, user=Depends(get_current_user)):
    m = await db.family_members.find_one({"member_id": member_id, "owner_id": user["user_id"], "status": "pending"}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Pending invitation not found")
    plan, _, _ = await seats(user)
    subject, html = invite_email(user["name"], plan["name"], f"{os.environ['APP_URL'].rstrip('/')}/family?join={member_id}")
    if not await send_email(to=m["email"], subject=subject, html=html):
        raise HTTPException(503, "Email is temporarily unavailable")
    return {"ok": True}


@router.post("/invitations/{member_id}/{action}")
async def respond(member_id: str, action: str, user=Depends(get_current_user)):
    m = await db.family_members.find_one({"member_id": member_id, "email": user["email"], "status": "pending"})
    if not m or action not in ("accept", "decline"):
        raise HTTPException(404, "Invitation not found")
    upd = {"status": "active", "user_id": user["user_id"], "joined_at": iso()} if action == "accept" else {"status": "declined"}
    await db.family_members.update_one({"member_id": member_id}, {"$set": upd})
    await audit(user["user_id"], f"family.{action}", {"owner_id": m["owner_id"]})
    return {"ok": True}


@router.patch("/members/{member_id}")
async def set_access(member_id: str, body: AccessIn, user=Depends(get_current_user)):
    if body.access not in ACCESS:
        raise HTTPException(400, "Invalid access level")
    r = await db.family_members.update_one({"member_id": member_id, "owner_id": user["user_id"]}, {"$set": {"access": body.access}})
    if not r.matched_count:
        raise HTTPException(404, "Member not found")
    return {"ok": True}


@router.delete("/members/{member_id}")
async def remove(member_id: str, user=Depends(get_current_user)):
    r = await db.family_members.update_one(
        {"member_id": member_id, "status": {"$in": ["pending", "active"]}, "$or": [{"owner_id": user["user_id"]}, {"user_id": user["user_id"]}]},
        {"$set": {"status": "removed"}})
    if not r.matched_count:
        raise HTTPException(404, "Member not found")
    await audit(user["user_id"], "family.remove", {"member_id": member_id})
    return {"ok": True}


async def membership(user, owner_id, need_edit=False):
    m = await db.family_members.find_one({"owner_id": owner_id, "user_id": user["user_id"], "status": "active"}, {"_id": 0})
    if not m:
        raise HTTPException(403, "You are not a member of this family")
    if need_edit and m["access"] != "editor":
        raise HTTPException(403, "You have view-only access")
    root = await system_folder(owner_id, "family")
    return m, root


async def in_shared(owner_id, root_id, folder_id):
    """Return the folder if it is the family root or nested inside it."""
    cur = await db.folders.find_one({"user_id": owner_id, "folder_id": folder_id, "deleted_at": None}, {"_id": 0})
    f = cur
    while cur:
        if cur["folder_id"] == root_id:
            return f
        cur = await db.folders.find_one({"user_id": owner_id, "folder_id": cur.get("parent_id")}, {"_id": 0}) if cur.get("parent_id") else None
    raise HTTPException(404, "Folder not found")


@router.get("/{owner_id}/browse")
async def shared_browse(owner_id: str, folder_id: Optional[str] = None, user=Depends(get_current_user)):
    m, root = await membership(user, owner_id)
    folder = await in_shared(owner_id, root["folder_id"], folder_id or root["folder_id"])
    crumbs, cur = [], folder
    while cur:
        crumbs.insert(0, {"folder_id": cur["folder_id"], "name": cur["name"]})
        if cur["folder_id"] == root["folder_id"]:
            break
        cur = await db.folders.find_one({"user_id": owner_id, "folder_id": cur["parent_id"]}, {"_id": 0})
    owner = await db.users.find_one({"user_id": owner_id}, {"_id": 0, "name": 1})
    return {"owner_name": owner.get("name", ""), "access": m["access"], "folder": {"folder_id": folder["folder_id"], "name": folder["name"]},
            "breadcrumbs": crumbs,
            "folders": await db.folders.find({"user_id": owner_id, "parent_id": folder["folder_id"], "deleted_at": None}, {"_id": 0, "user_id": 0}).sort("name", 1).to_list(500),
            "files": await db.files.find({"user_id": owner_id, "folder_id": folder["folder_id"], "deleted_at": None}, PROJ).sort("name", 1).to_list(2000)}


async def shared_file(owner_id, root_id, file_id):
    f = await db.files.find_one({"user_id": owner_id, "file_id": file_id, "deleted_at": None}, {"_id": 0})
    if not f or not f.get("folder_id"):
        raise HTTPException(404, "File not found")
    await in_shared(owner_id, root_id, f["folder_id"])
    return f


@router.get("/{owner_id}/files/{file_id}/content")
async def shared_content(owner_id: str, file_id: str, download: int = 0, user=Depends(get_current_user)):
    _, root = await membership(user, owner_id)
    f = await shared_file(owner_id, root["folder_id"], file_id)
    return FileResponse(storage.path(f["storage_key"]), media_type=f["mime"], filename=f["name"],
                        content_disposition_type="attachment" if download else "inline")


@router.post("/{owner_id}/upload")
async def shared_upload(owner_id: str, files: List[UploadFile] = File(...), folder_id: Optional[str] = Form(None), user=Depends(get_current_user)):
    _, root = await membership(user, owner_id, need_edit=True)
    folder = await in_shared(owner_id, root["folder_id"], folder_id or root["folder_id"])
    owner = await db.users.find_one({"user_id": owner_id}, {"_id": 0})
    results = []
    for up in files:
        await ensure_quota(owner, up.size or 0)
        fid = new_id("file")
        key = f"{owner_id}/{fid}"
        size, sha = storage.write_stream(key, up.file)
        if await find_duplicate(owner_id, sha):
            storage.delete(key)
            results.append({"name": up.filename, "status": "duplicate"})
            continue
        doc = {**file_doc(owner_id, folder["folder_id"], up.filename or "untitled", size, sha, key, source="family"), "uploaded_by": user["user_id"]}
        await db.files.insert_one(dict(doc))
        results.append({"name": up.filename, "status": "uploaded", "file": public_file(doc)})
    schedule_storage_check(owner_id)
    return {"results": results}


class SharedFolderIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    parent_id: Optional[str] = None


@router.post("/{owner_id}/folders")
async def shared_folder(owner_id: str, body: SharedFolderIn, user=Depends(get_current_user)):
    _, root = await membership(user, owner_id, need_edit=True)
    parent = await in_shared(owner_id, root["folder_id"], body.parent_id or root["folder_id"])
    f = {"folder_id": new_id("fld"), "user_id": owner_id, "name": body.name.strip(), "parent_id": parent["folder_id"],
         "system_key": None, "deleted_at": None, "created_at": iso()}
    await db.folders.insert_one(dict(f))
    f.pop("user_id")
    return f


@router.delete("/{owner_id}/files/{file_id}")
async def shared_delete(owner_id: str, file_id: str, user=Depends(get_current_user)):
    _, root = await membership(user, owner_id, need_edit=True)
    await shared_file(owner_id, root["folder_id"], file_id)
    await db.files.update_one({"file_id": file_id}, {"$set": {"deleted_at": iso(), "deleted_with": None}})
    return {"ok": True}
