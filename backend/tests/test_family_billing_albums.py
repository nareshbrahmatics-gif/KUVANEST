"""KuvaNest iteration-2 backend tests: Razorpay mock mode, Family sharing, Smart Albums."""
import io
import os
import uuid
import zipfile
import json
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://nest-storage.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@kuvanest.com", "password": "Admin@12345"}
DEMO = {"email": "demo@kuvanest.com", "password": "Demo@12345"}  # Family plan owner
MEM1 = {"email": "mem1@kuvanest.com", "password": "Member@123"}  # editor member of demo


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text}"
    return r.json()["token"], r.json()["user"]


def _bearer(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


def _register(email=None, password="Passw0rd!23", name="Test User", account_type="individual"):
    email = email or f"TEST_{uuid.uuid4().hex[:10]}@kuvatest.com"
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "password": password, "name": name, "account_type": account_type
    }, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    return email, password, data["token"], data["user"]


# ============================ BILLING / RAZORPAY MOCK MODE ============================
class TestBillingMock:
    def test_billing_payment_mode_mock(self):
        token, _ = _login(DEMO["email"], DEMO["password"])
        r = _bearer(token).get(f"{API}/billing")
        assert r.status_code == 200
        b = r.json()
        assert b["payment_mode"] == "mock", f"expected mock got {b['payment_mode']}"
        assert b.get("razorpay_key_id") is None

    def test_order_endpoint_rejects_without_keys(self):
        token, _ = _login(DEMO["email"], DEMO["password"])
        r = _bearer(token).post(f"{API}/billing/order", json={"plan_id": "personal"})
        assert r.status_code == 400
        assert "razorpay" in r.text.lower()

    def test_verify_endpoint_rejects_without_keys(self):
        token, _ = _login(DEMO["email"], DEMO["password"])
        r = _bearer(token).post(f"{API}/billing/verify", json={
            "razorpay_order_id": "order_x", "razorpay_payment_id": "pay_x", "razorpay_signature": "sig_x"
        })
        assert r.status_code == 400

    def test_webhook_rejected_without_secret(self):
        r = requests.post(f"{API}/razorpay/webhook", data=b"{}", headers={"X-Razorpay-Signature": "sig"})
        assert r.status_code == 400
        assert "webhook" in r.text.lower() or "not configured" in r.text.lower()

    def test_mock_subscribe_still_works(self):
        # fresh user upgrades via mock
        _, _, token, _ = _register()
        s = _bearer(token)
        r = s.post(f"{API}/billing/subscribe", json={"plan_id": "starter", "method": "upi"})
        assert r.status_code == 200, r.text
        assert r.json()["payment"]["status"] == "paid"


# ============================ FAMILY SHARING ============================
class TestFamilyGating:
    def test_free_user_cannot_invite(self):
        _, _, token, _ = _register()
        s = _bearer(token)
        ov = s.get(f"{API}/family").json()
        assert ov["seats_total"] == 0
        r = s.post(f"{API}/family/invite", json={"email": "foo@bar.com", "access": "editor"})
        assert r.status_code == 400
        assert "upgrade" in r.text.lower() or "family" in r.text.lower()

    def test_starter_user_cannot_invite(self):
        _, _, token, _ = _register()
        s = _bearer(token)
        s.post(f"{API}/billing/subscribe", json={"plan_id": "starter"})
        r = s.post(f"{API}/family/invite", json={"email": "foo@bar.com", "access": "editor"})
        assert r.status_code == 400


class TestFamilyInvite:
    def test_demo_family_overview(self):
        token, demo_user = _login(DEMO["email"], DEMO["password"])
        s = _bearer(token)
        ov = s.get(f"{API}/family").json()
        assert ov["plan"]["plan_id"] == "family"
        assert ov["seats_total"] == 4  # 5 members - 1 owner
        assert ov.get("family_folder_id")

    def test_self_invite_rejected(self):
        token, _ = _login(DEMO["email"], DEMO["password"])
        r = _bearer(token).post(f"{API}/family/invite", json={"email": DEMO["email"], "access": "editor"})
        assert r.status_code == 400

    def test_duplicate_invite_rejected(self):
        token, _ = _login(DEMO["email"], DEMO["password"])
        # mem1 already active; re-invite should 409
        r = _bearer(token).post(f"{API}/family/invite", json={"email": MEM1["email"], "access": "editor"})
        assert r.status_code == 409

    def test_invalid_access_rejected(self):
        token, _ = _login(DEMO["email"], DEMO["password"])
        r = _bearer(token).post(f"{API}/family/invite", json={"email": f"TEST_{uuid.uuid4().hex[:6]}@kuvatest.com", "access": "admin"})
        assert r.status_code == 400


class TestFamilyFullFlow:
    """Invite a fresh user, accept, shared upload/browse, change access, remove."""

    @pytest.fixture(scope="class")
    def ctx(self):
        owner_token, owner_user = _login(DEMO["email"], DEMO["password"])
        viewer_email, viewer_pw, viewer_token, viewer_user = _register(name="FamViewer")
        return {
            "owner_token": owner_token, "owner": owner_user,
            "viewer_email": viewer_email, "viewer_pw": viewer_pw,
            "viewer_token": viewer_token, "viewer": viewer_user,
        }

    def test_invite_as_viewer(self, ctx):
        s = _bearer(ctx["owner_token"])
        r = s.post(f"{API}/family/invite", json={"email": ctx["viewer_email"], "access": "viewer"})
        assert r.status_code == 200, r.text
        ctx["member_id"] = r.json()["member_id"]

    def test_viewer_sees_invitation(self, ctx):
        s = _bearer(ctx["viewer_token"])
        ov = s.get(f"{API}/family").json()
        assert any(m["member_id"] == ctx["member_id"] for m in ov["invitations"])

    def test_accept_invitation(self, ctx):
        s = _bearer(ctx["viewer_token"])
        r = s.post(f"{API}/family/invitations/{ctx['member_id']}/accept")
        assert r.status_code == 200
        ov = s.get(f"{API}/family").json()
        assert any(m["owner_id"] == ctx["owner"]["user_id"] for m in ov["memberships"])

    def test_viewer_can_browse_but_not_upload(self, ctx):
        s = _bearer(ctx["viewer_token"])
        r = s.get(f"{API}/family/{ctx['owner']['user_id']}/browse")
        assert r.status_code == 200
        assert r.json()["access"] == "viewer"
        # Upload must be forbidden
        up = requests.Session()
        up.headers.update({"Authorization": f"Bearer {ctx['viewer_token']}"})
        png = b"\x89PNG\r\n\x1a\n" + os.urandom(32)
        r = up.post(f"{API}/family/{ctx['owner']['user_id']}/upload",
                    files=[("files", ("TEST_v.png", png, "image/png"))])
        assert r.status_code == 403

    def test_viewer_cannot_browse_private_folder(self, ctx):
        # Owner's photos folder is private (not family-root). viewer should 404
        owner_s = _bearer(ctx["owner_token"])
        home = owner_s.get(f"{API}/home").json()
        private_fid = next(f["folder_id"] for f in home["folders"] if f["system_key"] == "photos")
        s = _bearer(ctx["viewer_token"])
        r = s.get(f"{API}/family/{ctx['owner']['user_id']}/browse", params={"folder_id": private_fid})
        assert r.status_code == 404

    def test_owner_promotes_to_editor(self, ctx):
        s = _bearer(ctx["owner_token"])
        r = s.patch(f"{API}/family/members/{ctx['member_id']}", json={"access": "editor"})
        assert r.status_code == 200

    def test_editor_can_upload_to_family_folder(self, ctx):
        # The viewer was promoted to editor
        up = requests.Session()
        up.headers.update({"Authorization": f"Bearer {ctx['viewer_token']}"})
        png = b"\x89PNG\r\n\x1a\n" + os.urandom(64)
        r = up.post(f"{API}/family/{ctx['owner']['user_id']}/upload",
                    files=[("files", (f"TEST_fam_{uuid.uuid4().hex[:6]}.png", png, "image/png"))])
        assert r.status_code == 200, r.text
        assert r.json()["results"][0]["status"] == "uploaded"
        ctx["uploaded_file_id"] = r.json()["results"][0]["file"]["file_id"]

    def test_shared_file_appears_in_owner_family_folder(self, ctx):
        owner_s = _bearer(ctx["owner_token"])
        ov = owner_s.get(f"{API}/family").json()
        family_fid = ov["family_folder_id"]
        r = owner_s.get(f"{API}/browse", params={"folder_id": family_fid})
        assert r.status_code == 200
        assert any(f["file_id"] == ctx["uploaded_file_id"] for f in r.json()["files"])

    def test_editor_can_create_subfolder_in_shared(self, ctx):
        s = _bearer(ctx["viewer_token"])
        r = s.post(f"{API}/family/{ctx['owner']['user_id']}/folders", json={"name": f"TEST_sub_{uuid.uuid4().hex[:6]}"})
        assert r.status_code == 200
        assert r.json().get("folder_id")

    def test_editor_can_delete_shared_file(self, ctx):
        s = _bearer(ctx["viewer_token"])
        r = s.delete(f"{API}/family/{ctx['owner']['user_id']}/files/{ctx['uploaded_file_id']}")
        assert r.status_code == 200

    def test_owner_removes_member_access_lost(self, ctx):
        owner_s = _bearer(ctx["owner_token"])
        r = owner_s.delete(f"{API}/family/members/{ctx['member_id']}")
        assert r.status_code == 200
        # Now removed member should 403 on browse
        r = _bearer(ctx["viewer_token"]).get(f"{API}/family/{ctx['owner']['user_id']}/browse")
        assert r.status_code == 403


class TestFamilyLeave:
    def test_member_can_leave_own_membership(self):
        owner_token, owner = _login(DEMO["email"], DEMO["password"])
        em, pw, mem_token, mem_user = _register()
        # invite + accept
        r = _bearer(owner_token).post(f"{API}/family/invite", json={"email": em, "access": "viewer"})
        assert r.status_code == 200
        mid = r.json()["member_id"]
        _bearer(mem_token).post(f"{API}/family/invitations/{mid}/accept")
        # leave
        r = _bearer(mem_token).delete(f"{API}/family/members/{mid}")
        assert r.status_code == 200


# ============================ SMART ALBUMS ============================
def _takeout_trip_zip():
    """Build a Takeout zip of 4 photos spanning 3 consecutive days inside a 'Goa Trip' folder."""
    buf = io.BytesIO()
    base = 1704067200  # 2024-01-01 00:00:00 UTC
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for i, offset in enumerate([0, 86400, 86400 * 2, 86400 * 2 + 3600]):
            fname = f"Takeout/Google Photos/Goa Trip/pic{i}.jpg"
            # unique content so dedup doesn't drop them
            z.writestr(fname, b"\x89PNG\r\n\x1a\n" + os.urandom(128) + str(i).encode())
            z.writestr(fname + ".json",
                       json.dumps({"title": f"pic{i}.jpg", "photoTakenTime": {"timestamp": str(base + offset)}}))
    buf.seek(0)
    return buf.read()


class TestAlbums:
    @pytest.fixture(scope="class")
    def ctx(self):
        _, _, token, user = _register(name="AlbumUser")
        s = _bearer(token)
        # Import a Takeout zip to create a trip
        data = _takeout_trip_zip()
        r = s.post(f"{API}/uploads/init", json={"filename": "TEST_goa.zip", "size": len(data)})
        upload_id = r.json()["upload_id"]
        r = requests.put(f"{API}/uploads/{upload_id}/chunk", params={"offset": 0}, data=data,
                         headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        r = s.post(f"{API}/migrations", json={"source": "google_takeout", "upload_id": upload_id})
        job_id = r.json()["job_id"]
        for _ in range(30):
            time.sleep(1)
            j = s.get(f"{API}/migrations/{job_id}").json()
            if j["status"] in ("completed", "failed"):
                break
        assert j["status"] == "completed", j
        assert j["imported"] >= 3
        return {"token": token, "s": s}

    def test_albums_list_has_month_and_trip(self, ctx):
        r = ctx["s"].get(f"{API}/albums")
        assert r.status_code == 200
        albums = r.json()
        types = {a["type"] for a in albums}
        assert "month" in types
        assert "trip" in types, f"expected trip album in {albums}"
        # trip should be titled 'Goa Trip'
        trip = next(a for a in albums if a["type"] == "trip")
        assert "Goa" in trip["title"] or trip["title"] == "Trip"
        assert trip["count"] >= 3
        assert trip.get("cover")
        ctx["trip_id"] = trip["album_id"]
        ctx["month_id"] = next(a for a in albums if a["type"] == "month")["album_id"]

    def test_album_detail(self, ctx):
        r = ctx["s"].get(f"{API}/albums/{ctx['trip_id']}")
        assert r.status_code == 200
        data = r.json()
        assert len(data["files"]) >= 3
        assert data["type"] == "trip"

    def test_album_not_found(self, ctx):
        r = ctx["s"].get(f"{API}/albums/doesnotexist")
        assert r.status_code == 404

    def test_empty_user_returns_empty_list(self):
        _, _, token, _ = _register()
        r = _bearer(token).get(f"{API}/albums")
        assert r.status_code == 200
        assert r.json() == []
