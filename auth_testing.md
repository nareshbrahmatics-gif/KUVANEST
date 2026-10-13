# Auth testing (KuvaNest)
- Email/password: POST /api/auth/login with creds in /app/memory/test_credentials.md. Response JSON has `token` (usable as `Authorization: Bearer`) and sets httpOnly cookie `session_token`.
- Google (Emergent-managed): to test without real Google, insert into mongo `user_sessions` {session_id, session_token, user_id, method:'google', created_at, expires_at (ISO string, +7d)} for an existing users.user_id, then set cookie `session_token` (secure, sameSite None) in the browser.
- All queries use `{"_id": 0}`; users keyed by custom `user_id`.
