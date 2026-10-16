# KuvaNest Mobile (Android & iOS)

React Native + Expo app that talks to the same KuvaNest API as the web app.

## Run
```bash
cd mobile
npm install            # or yarn
npx expo install --fix # aligns Expo package versions with your installed SDK
npx expo start         # scan the QR with Expo Go
```
Set the API URL in `app.json` → `expo.extra.apiUrl` (e.g. `https://api.kuvanest.com/api`).

## Included
- Email sign-in (token stored in SecureStore, sent as Bearer)
- Home: storage meter + yellow folders, "Back up photos" (pick photos/videos → auto-sorted upload)
- Photos grid, Files browser, Transfer info, Account/logout
- Automatic camera backup (foreground + OS background task)
- Bottom tabs: Home | Photos | Files | Transfer | Account

## Not yet
- Google sign-in on mobile, archive upload from phone, store billing.

## Automatic backup
Live progress ("12 of 40 photos & videos backed up") shows on Home and Account while a backup runs.
Account → Automatic photo backup. Uploads new photos/videos on app open and via `expo-background-task` (OS-scheduled, min 15 min; iOS/Android decide actual timing). Options: **Only on Wi-Fi** (default on) and **Only while charging**; "Back up now" ignores them. Needs a development build (`npx expo run:android` / `run:ios`) — background tasks don't run in Expo Go.
