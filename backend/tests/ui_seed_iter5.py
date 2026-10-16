"""Seed a throwaway user for iteration-5 UI testing: starter subscription + fake 42GB file (84%)."""
import json, time, uuid, requests
from datetime import datetime, timezone
from pymongo import MongoClient
API = "https://nest-storage.preview.emergentagent.com/api"
db = MongoClient("mongodb://localhost:27017")["test_database"]
email = f"delivered+knui{int(time.time())}@resend.dev"
r = requests.post(f"{API}/auth/register", json={"email": email, "password": "Passw0rd!23", "name": "TEST UI", "account_type": "individual"})
s = requests.Session(); s.headers["Authorization"] = f"Bearer {r.json()['token']}"
uid = r.json()["user"]["user_id"]
pay = s.post(f"{API}/billing/subscribe", json={"plan_id": "starter"}).json()["payment"]
fid = f"file_TESTfake{uuid.uuid4().hex[:8]}"
db.files.insert_one({"file_id": fid, "user_id": uid, "folder_id": None, "name": "TEST_fake.bin", "size": 42 * 1024 ** 3,
                     "kind": "other", "mime": "application/octet-stream", "sha256": uuid.uuid4().hex, "key": "fake",
                     "deleted_at": None, "created_at": datetime.now(timezone.utc).isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()})
s.post(f"{API}/files/upload", files={"files": ("t.txt", uuid.uuid4().hex.encode(), "text/plain")})
time.sleep(4)
print(json.dumps({"email": email, "uid": uid, "payment_id": pay["payment_id"], "fake": fid, "notifs": s.get(f"{API}/notifications").json()["unread"]}))
