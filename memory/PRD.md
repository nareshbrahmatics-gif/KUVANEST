# KuvaNest PRD

## Original problem
KuvaNest – India-first personal cloud storage & smart backup ("Your Files. Your Photos. Your Storage. One Simple Nest."). Yellow-folder mobile-first UI, files/photos, migration from Google (and per user: iCloud, Dropbox, Azure/OneDrive), INR plans, family, hardware box, reseller portal, admin. Suitable for individuals and enterprises.

## User choices
- MVP: core cloud + archive (Takeout etc.) import + admin dashboard
- Auth: email/password + Emergent Google sign-in
- Payments: MOCKED (Stripe sandbox not supported for India); Razorpay/Stripe later
- Storage: local disk adapter now; Extreme Compute VMs/containers later (details TBD)

## Architecture (as built)
React (CRA) + FastAPI + MongoDB. Backend modules: core.py (db, LocalObjectStorage adapter, auth deps, quota), auth_routes.py, file_routes.py, migration.py (chunked uploads + asyncio ZIP import worker), billing_admin.py (plans, mock billing, admin).

## Implemented (2026-06)
- Auth: register/login (bcrypt, lockout after 5 fails), Google OAuth, cookie sessions, session list/revoke, logout, account deletion
- 6 default yellow folders; folders CRUD/move; files upload (auto-routing), download, preview, rename, move, copy, favourite, search/sort/filter, SHA-256 dedupe, share links with expiry
- Photos gallery (date groups, lightbox, favourites); Recycle bin (30-day retention, restore, purge)
- Transfer: resumable chunked ZIP upload; import jobs for Google Takeout (sidecar dates), iCloud, Dropbox, OneDrive, Azure; zip-slip/ratio protection, quota check, size checks, duplicates, pause/resume/cancel/retry, error report
- Plans (Free, Starter ₹100, Personal ₹199, Family ₹499, Premium ₹999, Business ₹2999) with MOCKED checkout + GST, invoices, cancel renewal
- Admin: stats/MRR, users (suspend), migrations, plan & GST config, payments, audit logs
- Landing page with pricing & FAQ

## Backlog
- P0: real payments (Razorpay), Extreme Compute storage adapter, family member invites & shared folders
- P1: Google Drive/Photos Picker connectors, business team seats, thumbnails/HEIC conversion, file versioning
- P2: React Native app & camera backup, Go device agent (KuvaNest Box), reseller portal, malware scanning
