"""Iteration 5: payment receipts + GST invoice PDF, daily cron (renewal reminders), storage alerts, notifications API."""
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://nest-storage.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN = {"email": "admin@kuvanest.com", "password": "Admin@12345"}
DEMO = {"email": "demo@kuvanest.com", "password": "Demo@12345"}
GB = 1024 ** 3


def _secret():
    for line in open("/app/backend/.env"):
        if line.startswith("WEBHOOK_CRON_SECRET="):
            return line.split("=", 1)[1].strip().strip('"')


SECRET = _secret()
db = MongoClient("mongodb://localhost:27017")["test_database"]


def _bearer(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, r.text
    return _bearer(r.json()["token"])


def _new_user(tag):
    email = f"delivered+kn{tag}{int(time.time()*1000)}@resend.dev"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": "Passw0rd!23", "name": f"TEST {tag}",
                                                    "account_type": "individual"}, timeout=15)
    assert r.status_code == 200, r.text
    return _bearer(r.json()["token"]), r.json()["user"]["user_id"], email


def _notifs(s, ntype=None):
    r = s.get(f"{API}/notifications", timeout=15)
    assert r.status_code == 200
    items = r.json()["items"]
    return [n for n in items if ntype is None or n["type"] == ntype], r.json()


def _wait_for(fn, timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(1)
    return fn()


def _cron(run_id=None, token=SECRET, body=None):
    h = {}
    if token is not None:
        h["Authorization"] = f"Bearer {token}"
    if run_id:
        h["X-Webhook-Id"] = run_id
    return requests.post(f"{API}/cron/daily", headers=h, json=body if body is not None else {"run_id": run_id or "x"}, timeout=20)


def _upload(s, tag):
    data = f"tiny-{tag}-{uuid.uuid4().hex}".encode()
    r = s.post(f"{API}/files/upload", files={"files": (f"t_{tag}.txt", data, "text/plain")}, timeout=20)
    assert r.status_code == 200, r.text
    return r


@pytest.fixture(scope="module")
def payer():
    s, uid, email = _new_user("pay")
    r = s.post(f"{API}/billing/subscribe", json={"plan_id": "starter", "method": "upi"}, timeout=20)
    assert r.status_code == 200, r.text
    return s, uid, email, r.json()["payment"]


# ---- Payment receipt + invoice PDF ----
class TestReceiptInvoice:
    def test_payment_notification(self, payer):
        s, _, _, pay = payer
        items = _wait_for(lambda: _notifs(s, "payment")[0])
        assert len(items) == 1
        assert items[0]["link"] == f"/invoice/{pay['payment_id']}"
        assert pay["invoice_no"] in items[0]["body"]

    def test_pdf_owner(self, payer):
        s, _, _, pay = payer
        r = s.get(f"{API}/billing/invoices/{pay['payment_id']}/pdf", timeout=20)
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("application/pdf")
        assert r.content[:4] == b"%PDF"

    def test_pdf_other_user_404(self, payer):
        _, _, _, pay = payer
        d = _login(DEMO)
        assert d.get(f"{API}/billing/invoices/{pay['payment_id']}/pdf", timeout=15).status_code == 404

    def test_pdf_admin(self, payer):
        _, _, _, pay = payer
        a = _login(ADMIN)
        r = a.get(f"{API}/billing/invoices/{pay['payment_id']}/pdf", timeout=15)
        assert r.status_code == 200 and r.content[:4] == b"%PDF"

    def test_pdf_unknown_404_and_unauth_401(self, payer):
        s, _, _, pay = payer
        assert s.get(f"{API}/billing/invoices/pay_doesnotexist/pdf", timeout=15).status_code == 404
        assert requests.get(f"{API}/billing/invoices/{pay['payment_id']}/pdf", timeout=15).status_code == 401

    def test_receipt_marked_sent(self, payer):
        _, _, _, pay = payer
        doc = _wait_for(lambda: db.payments.find_one({"payment_id": pay["payment_id"], "receipt_sent_at": {"$exists": True}}), 20)
        # best-effort email; report but don't hard fail on provider rate limit
        if not doc:
            pytest.xfail("receipt_sent_at not set (email provider may have rate limited)")

    def test_notifications_read_all(self, payer):
        s, _, _, _ = payer
        assert _notifs(s)[1]["unread"] >= 1
        assert s.post(f"{API}/notifications/read-all", timeout=15).status_code == 200
        assert _notifs(s)[1]["unread"] == 0


# ---- Cron auth/idempotency ----
class TestCron:
    def test_no_bearer_401(self):
        assert _cron(token=None).status_code == 401

    def test_wrong_bearer_401(self):
        assert _cron(token="wrong").status_code == 401

    def test_accept_then_duplicate(self):
        rid = f"TEST_run_{uuid.uuid4().hex}"
        r = _cron(rid)
        assert r.status_code in (200, 202) and r.json()["status"] == "accepted"
        r2 = _cron(rid)
        assert r2.status_code in (200, 202) and r2.json()["status"] == "duplicate"

    def test_empty_body(self):
        # platform may send no body — record behaviour
        h = {"Authorization": f"Bearer {SECRET}", "X-Webhook-Id": f"TEST_run_{uuid.uuid4().hex}"}
        r = requests.post(f"{API}/cron/daily", headers=h, timeout=20)
        print("empty body status", r.status_code, r.text)
        assert r.status_code in (200, 202, 400)


# ---- Renewal reminders ----
class TestRenewal:
    def test_reminder_once(self, payer):
        s, uid, _, _ = payer
        rd = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        db.users.update_one({"user_id": uid}, {"$set": {"renewal_date": rd, "cancel_at_period_end": False}})
        assert _cron(f"TEST_run_{uuid.uuid4().hex}").json()["status"] == "accepted"
        items = _wait_for(lambda: _notifs(s, "renewal")[0], 30)
        assert len(items) == 1
        _cron(f"TEST_run_{uuid.uuid4().hex}")
        time.sleep(8)
        assert len(_notifs(s, "renewal")[0]) == 1
        assert db.users.find_one({"user_id": uid})["renewal_reminder_for"] == rd

    def test_cancelled_and_far_none(self):
        s1, u1, _ = _new_user("cancel")
        s2, u2, _ = _new_user("far")
        for s in (s1, s2):
            assert s.post(f"{API}/billing/subscribe", json={"plan_id": "starter"}, timeout=20).status_code == 200
        t = datetime.now(timezone.utc)
        db.users.update_one({"user_id": u1}, {"$set": {"renewal_date": (t + timedelta(days=2)).isoformat(), "cancel_at_period_end": True}})
        db.users.update_one({"user_id": u2}, {"$set": {"renewal_date": (t + timedelta(days=5)).isoformat()}})
        _cron(f"TEST_run_{uuid.uuid4().hex}")
        time.sleep(12)
        assert _notifs(s1, "renewal")[0] == []
        assert _notifs(s2, "renewal")[0] == []


# ---- Storage alerts ----
class TestStorageAlert:
    def test_levels(self):
        s, uid, _ = _new_user("store")
        fake = {"file_id": f"file_TESTfake{uuid.uuid4().hex[:8]}", "user_id": uid, "folder_id": None, "name": "TEST_fake.bin",
                "size": int(4.2 * GB), "kind": "other", "mime": "application/octet-stream", "sha256": uuid.uuid4().hex,
                "key": "fake", "deleted_at": None, "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat()}
        db.files.insert_one(dict(fake))
        try:
            _upload(s, "a")
            items = _wait_for(lambda: _notifs(s, "storage")[0])
            assert len(items) == 1 and "84%" in items[0]["title"], items
            assert db.users.find_one({"user_id": uid})["storage_alert_level"] == 80
            # same level -> no duplicate
            _upload(s, "b")
            time.sleep(3)
            assert len(_notifs(s, "storage")[0]) == 1
            # push to 96%
            db.files.update_one({"file_id": fake["file_id"]}, {"$set": {"size": int(4.8 * GB)}})
            _upload(s, "c")
            items = _wait_for(lambda: len(_notifs(s, "storage")[0]) == 2 and _notifs(s, "storage")[0])
            assert items and len(items) == 2
            assert db.users.find_one({"user_id": uid})["storage_alert_level"] == 95
            st = s.get(f"{API}/storage", timeout=15).json()
            assert st["used"] / st["quota"] >= 0.95
        finally:
            db.files.delete_one({"file_id": fake["file_id"]})
        _upload(s, "d")
        time.sleep(3)
        assert db.users.find_one({"user_id": uid})["storage_alert_level"] == 0
        assert len(_notifs(s, "storage")[0]) == 2
