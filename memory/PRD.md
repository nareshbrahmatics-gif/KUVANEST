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

## Iteration 2 (2026-06)
- New KuvaNest logo (white lotus on blue) + favicon; theme blue #1F94C8, folders & login buttons stay yellow
- Razorpay checkout (order -> checkout.js -> server signature verify + payment fetch; webhook /api/razorpay/webhook with HMAC + event idempotency). Keys empty -> MOCK mode
- Family sharing: invites (seats from plan), accept/decline, viewer/editor access, remove/leave, shared Family Files browse/upload/folder/delete using owner's quota
- Smart Albums: trips (date clusters, folder-named) + months
- /app/mobile Expo app (login, home folders, photo backup picker, photos, files, account); README repo layout

## Iteration 3 (2026-06)
- Family invite emails (Emergent-managed Resend) with one-tap join link /family?join=<id> (auto-accept after login; login keeps ?next=); Resend invite
- Google Drive Picker + Google Photos Picker import (backend OAuth, Fernet-encrypted refresh token, background jobs via migration_jobs mode=api, Docs exported to Office formats). NOT CONFIGURED until GOOGLE_CLIENT_ID/SECRET/API_KEY/PROJECT_NUMBER added
- Transfer animation (files flying from source cloud into yellow nest) during uploads/imports
- Mobile: automatic camera backup (foreground + expo-background-task)
- Landing tagline: India-first personal and enterprise sovereign cloud storage

## Backlog
- P0: add Razorpay keys (live payments), Extreme Compute storage adapter
- P1: Google Drive/Photos Picker connectors, business team seats, thumbnails/HEIC conversion, file versioning
- P2: React Native app & camera backup, Go device agent (KuvaNest Box), reseller portal, malware scanning
