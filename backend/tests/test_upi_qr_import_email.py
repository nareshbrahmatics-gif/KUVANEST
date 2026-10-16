"""Iteration 4: Razorpay UPI QR (mock mode) + import-done email notifications."""
import io
import os
import time
import uuid
import zipfile
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://nest-storage.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
DEMO = {"email": "demo@kuvanest.com", "password": "Demo@12345"}


def _mongo():
    return MongoClient("mongodb://localhost:27017")["test_database"]


def _bearer(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def demo():
    r = requests.post(f"{API}/auth/login", json=DEMO, timeout=15)
    assert r.status_code == 200
    return _bearer(r.json()["token"])


@pytest.fixture(scope="module")
def resend_user():
    email = f"delivered+kn{int(time.time())}@resend.dev"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": "Passw0rd!23", "name": "TEST Importer",
                                                    "account_type": "individual"}, timeout=15)
    assert r.status_code == 200, r.text
    return _bearer(r.json()["token"]), email


# ---- UPI QR (mock mode) ----
class TestUpiQrMock:
    def test_billing_mode_mock(self, demo):
        r = demo.get(f"{API}/billing")
        assert r.status_code == 200
        assert r.json()["payment_mode"] == "mock"
        assert r.json()["razorpay_key_id"] is None

    def test_create_upi_qr_not_configured(self, demo):
        r = demo.post(f"{API}/billing/upi-qr", json={"plan_id": "premium"})
        assert r.status_code == 400
        assert r.json()["detail"] == "Razorpay is not configured yet"

    def test_upi_qr_status_unknown_404(self, demo):
        r = demo.get(f"{API}/billing/upi-qr/qr_unknown123")
        assert r.status_code == 404
        assert r.json()["detail"] == "QR not found"

    def test_upi_qr_requires_auth(self):
        assert requests.post(f"{API}/billing/upi-qr", json={"plan_id": "premium"}).status_code == 401
        assert requests.get(f"{API}/billing/upi-qr/x").status_code == 401

    def test_webhook_without_secret(self):
        r = requests.post(f"{API}/razorpay/webhook", json={"event": "qr_code.credited"})
        assert r.status_code == 400
        assert "not configured" in r.json()["detail"].lower()

    def test_order_not_configured(self, demo):
        r = demo.post(f"{API}/billing/order", json={"plan_id": "premium"})
        assert r.status_code == 400


def _make_zip(tag):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for i in range(3):
            z.writestr(f"Takeout/Google Photos/Album/img_{tag}_{i}.jpg", os.urandom(2048) + tag.encode())
        z.writestr("Takeout/Google Photos/Album/img_0.jpg.json", '{"title":"img_0.jpg","photoTakenTime":{"timestamp":"1600000000"}}')
    return buf.getvalue()


def _upload_and_import(s, data):
    r = s.post(f"{API}/uploads/init", json={"filename": "takeout.zip", "size": len(data)})
    assert r.status_code == 200, r.text
    uid = r.json()["upload_id"]
    r = s.put(f"{API}/uploads/{uid}/chunk", params={"offset": 0}, data=data,
              headers={"Content-Type": "application/octet-stream"})
    assert r.status_code == 200 and r.json()["complete"]
    r = s.post(f"{API}/migrations", json={"source": "google_takeout", "upload_id": uid})
    assert r.status_code == 200, r.text
    return r.json()["job_id"]


def _wait(s, job_id, timeout=60):
    for _ in range(timeout):
        j = s.get(f"{API}/migrations/{job_id}").json()
        if j["status"] in ("completed", "failed"):
            return j
        time.sleep(1)
    return j


# ---- Import-done email ----
class TestImportEmail:
    state = {}

    def test_zip_import_completes_and_notifies(self, resend_user):
        s, email = resend_user
        job_id = _upload_and_import(s, _make_zip(uuid.uuid4().hex[:6]))
        j = _wait(s, job_id)
        assert j["status"] == "completed", j
        assert j["imported"] == 3 and j["failed"] == 0
        assert j["dest_folder_id"]
        time.sleep(4)
        doc = _mongo().migration_jobs.find_one({"job_id": job_id})
        TestImportEmail.state["job_id"] = job_id
        TestImportEmail.state["notified_at"] = doc.get("notified_at")
        print("notified_at:", doc.get("notified_at"))

    def test_retry_resets_notified_at_and_reruns(self, resend_user):
        s, _ = resend_user
        job_id = TestImportEmail.state["job_id"]
        r = s.post(f"{API}/migrations/{job_id}/retry")
        assert r.status_code == 200, r.text
        assert r.json().get("notified_at") is None
        assert r.json()["status"] in ("queued", "running", "completed")
        j = _wait(s, job_id)
        assert j["status"] == "completed"
        assert j["processed"] == 3
        print("after retry:", {k: j[k] for k in ("imported", "duplicates", "failed", "processed", "total_files")})
        time.sleep(4)
        doc = _mongo().migration_jobs.find_one({"job_id": job_id})
        print("notified_at after retry:", doc.get("notified_at"), "before:", TestImportEmail.state["notified_at"])

    def test_retry_of_running_rejected(self, resend_user):
        s, _ = resend_user
        r = s.post(f"{API}/migrations/{TestImportEmail.state['job_id']}/pause")
        assert r.status_code == 400
