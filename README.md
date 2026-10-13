# KuvaNest

Your Files. Your Photos. Your Storage. One Simple Nest.

## Repository layout
| Folder | App |
| --- | --- |
| `frontend/` | **Web application** (React) – customer site, dashboard, admin |
| `backend/` | **API server** (FastAPI + MongoDB) – shared by web and mobile |
| `mobile/` | **Mobile application** (React Native + Expo, Android & iOS) – see `mobile/README.md` |

## Payments (Razorpay)
Set in `backend/.env`: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
Leave empty to keep simulated (mock) payments. Webhook URL: `https://<your-domain>/api/razorpay/webhook`
(events: `payment.captured`, `order.paid`, `payment.failed`).

## Storage
Files are written by `LocalObjectStorage` in `backend/core.py` to `STORAGE_ROOT`. Swap this adapter for
Extreme Compute (S3-compatible or mounted disk) when ready.
