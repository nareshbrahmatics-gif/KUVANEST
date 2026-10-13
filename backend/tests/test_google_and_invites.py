"""Tests for iteration 3: Google import (not-configured gates), family invite emails, resend."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://nest-storage.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO = {"email": "demo@kuvanest.com", "password": "Demo@12345"}


def _bearer(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _register(email=None, password="Passw0rd!23", name="Test User"):
    email = email or f"TEST_{uuid.uuid4().hex[:10]}@kuvatest.com"
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "password": password, "name": name, "account_type": "individual"
    }, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    return email, password, data["token"], data["user"]


# ------------------------- Google import (not configured) -------------------------
class TestGoogleNotConfigured:
    @pytest.fixture(scope="class")
    def demo(self):
        return _bearer(_login(DEMO["email"], DEMO["password"]))

    def test_status_not_configured(self, demo):
        r = demo.get(f"{API}/google/status")
        assert r.status_code == 200
        d = r.json()
        assert d == {"configured": False, "connected": False}

    def test_oauth_start_503(self, demo):
        r = demo.post(f"{API}/google/oauth/start", json={"origin_url": "https://nest-storage.preview.emergentagent.com"})
        assert r.status_code == 503
        assert "not set up" in r.text.lower()

    def test_drive_import_503(self, demo):
        r = demo.post(f"{API}/google/drive/import", json={"file_ids": ["abc"]})
        assert r.status_code == 503

    def test_photos_session_503(self, demo):
        r = demo.post(f"{API}/google/photos/session")
        assert r.status_code == 503

    def test_picker_config_503(self, demo):
        r = demo.get(f"{API}/google/picker-config")
        assert r.status_code == 503

    def test_callback_bad_state_400(self):
        r = requests.get(f"{API}/google/callback", params={"state": "garbage", "code": "x"},
                         allow_redirects=False, timeout=15)
        assert r.status_code == 400

    def test_requires_auth(self):
        # Endpoints requiring auth should 401 without a token (not 503)
        r = requests.get(f"{API}/google/status")
        assert r.status_code in (401, 403)


# ------------------------- Family invite email + resend -------------------------
class TestFamilyInviteEmail:
    @pytest.fixture(scope="class")
    def demo_s(self):
        return _bearer(_login(DEMO["email"], DEMO["password"]))

    @pytest.fixture(scope="class")
    def cleanup_ids(self):
        return []

    def test_invite_sends_email_resend_sandbox(self, demo_s, cleanup_ids):
        # Use Resend sandbox address
        target = "delivered@resend.dev"
        # First, in case lingering from prior tests, try to remove it
        ov = demo_s.get(f"{API}/family").json()
        for m in ov["members"]:
            if m["email"] == target:
                demo_s.delete(f"{API}/family/members/{m['member_id']}")
        r = demo_s.post(f"{API}/family/invite", json={"email": target, "access": "editor"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["email"] == target
        assert data["status"] == "pending"
        assert data.get("email_sent") is True, f"email_sent not True: {data}"
        cleanup_ids.append(data["member_id"])

    def test_resend_pending(self, demo_s, cleanup_ids):
        assert cleanup_ids, "requires prior invite"
        mid = cleanup_ids[0]
        r = demo_s.post(f"{API}/family/members/{mid}/resend")
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

    def test_resend_nonexistent_404(self, demo_s):
        r = demo_s.post(f"{API}/family/members/doesnotexist/resend")
        assert r.status_code == 404

    def test_resend_active_member_404(self, demo_s):
        # mem1 is already active -> not pending
        ov = demo_s.get(f"{API}/family").json()
        active = next((m for m in ov["members"] if m["status"] == "active"), None)
        if not active:
            pytest.skip("no active member to test against")
        r = demo_s.post(f"{API}/family/members/{active['member_id']}/resend")
        assert r.status_code == 404

    def test_cleanup(self, demo_s, cleanup_ids):
        for mid in cleanup_ids:
            demo_s.delete(f"{API}/family/members/{mid}")


# ------------------------- Join link flow (auto-accept after login) -------------------------
class TestJoinLinkAutoAccept:
    def test_wrong_email_rejected(self):
        # Demo invites joiner_X, but someone else accepts -> should 404
        demo = _bearer(_login(DEMO["email"], DEMO["password"]))
        target = f"TEST_joiner_{uuid.uuid4().hex[:8]}@kuvatest.com"
        r = demo.post(f"{API}/family/invite", json={"email": target, "access": "editor"})
        assert r.status_code == 200
        mid = r.json()["member_id"]
        # Register a different user and try to accept
        _, _, other_token, _ = _register()
        r = _bearer(other_token).post(f"{API}/family/invitations/{mid}/accept")
        assert r.status_code == 404
        # Cleanup
        demo.delete(f"{API}/family/members/{mid}")

    def test_correct_email_auto_accept(self):
        demo = _bearer(_login(DEMO["email"], DEMO["password"]))
        target = f"TEST_joiner_{uuid.uuid4().hex[:8]}@kuvatest.com"
        r = demo.post(f"{API}/family/invite", json={"email": target, "access": "editor"})
        assert r.status_code == 200
        mid = r.json()["member_id"]
        # Register user with that exact email
        _, _, token, _ = _register(email=target)
        # Accept invite as that user (simulates auto-accept done by Family page on ?join=)
        r = _bearer(token).post(f"{API}/family/invitations/{mid}/accept")
        assert r.status_code == 200
        # Verify active membership
        ov = _bearer(token).get(f"{API}/family").json()
        assert any(m["member_id"] == mid and m["status"] == "active" for m in ov["memberships"])
        # Cleanup: user leaves
        _bearer(token).delete(f"{API}/family/members/{mid}")


# ------------------------- Migration regression (zip import still works) -------------------------
class TestMigrationRegression:
    def test_retry_job(self):
        # Minimal regression — just ensure endpoints respond
        _, _, token, _ = _register()
        s = _bearer(token)
        r = s.get(f"{API}/migrations")
        assert r.status_code == 200
        assert isinstance(r.json(), list)
