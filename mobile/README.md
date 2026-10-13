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
- Bottom tabs: Home | Photos | Files | Transfer | Account

## Not yet
- Google sign-in on mobile, automatic background camera backup, archive upload from phone, store billing.
