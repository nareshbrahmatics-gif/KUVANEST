from collections import Counter
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends
from core import db, get_current_user

router = APIRouter(prefix="/api/albums")
PROJ = {"_id": 0, "storage_key": 0, "user_id": 0}
TRIP_GAP_DAYS = 2
TRIP_MIN = 3


def ts(f):
    return datetime.fromisoformat(f.get("taken_at") or f["created_at"])


def span_label(a, b):
    if a.date() == b.date():
        return a.strftime("%d %b %Y")
    if a.year == b.year and a.month == b.month:
        return f"{a.day}–{b.day} {b.strftime('%b %Y')}"
    return f"{a.strftime('%d %b')} – {b.strftime('%d %b %Y')}"


async def build_albums(uid):
    media = await db.files.find({"user_id": uid, "deleted_at": None, "kind": {"$in": ["image", "video"]}}, PROJ).to_list(20000)
    media.sort(key=ts)
    folders = {f["folder_id"]: f for f in await db.folders.find({"user_id": uid}, {"_id": 0, "folder_id": 1, "name": 1, "system_key": 1}).to_list(10000)}
    albums = {}
    for f in media:
        d = ts(f)
        key = f"month-{d:%Y-%m}"
        albums.setdefault(key, {"album_id": key, "type": "month", "title": d.strftime("%B %Y"), "files": []})["files"].append(f)
    cluster = []
    clusters = []
    for f in media:
        if cluster and (ts(f) - ts(cluster[-1])).total_seconds() > TRIP_GAP_DAYS * 86400:
            clusters.append(cluster)
            cluster = []
        cluster.append(f)
    if cluster:
        clusters.append(cluster)
    for c in clusters:
        a, b = ts(c[0]), ts(c[-1])
        if len(c) < TRIP_MIN or a.date() == b.date():
            continue
        names = Counter(folders[x["folder_id"]]["name"] for x in c if x.get("folder_id") in folders
                        and not folders[x["folder_id"]].get("system_key") and not folders[x["folder_id"]]["name"].startswith("Import "))
        name = names.most_common(1)[0][0] if names else "Trip"
        key = f"trip-{c[0]['file_id']}"
        albums[key] = {"album_id": key, "type": "trip", "title": name, "subtitle": span_label(a, b), "files": c}
    out = sorted(albums.values(), key=lambda x: (x["type"] != "trip", -ts(x["files"][-1]).timestamp()))
    for al in out:
        al["files"].sort(key=ts, reverse=True)
    return out


@router.get("")
async def list_albums(user=Depends(get_current_user)):
    return [{"album_id": a["album_id"], "type": a["type"], "title": a["title"], "subtitle": a.get("subtitle"),
             "count": len(a["files"]), "cover": a["files"][0]} for a in await build_albums(user["user_id"])]


@router.get("/{album_id}")
async def get_album(album_id: str, user=Depends(get_current_user)):
    for a in await build_albums(user["user_id"]):
        if a["album_id"] == album_id:
            return a
    raise HTTPException(404, "Album not found")
