# PharmacyStockCard

## Start Project

### Open Project

```bash
cd /d F:\Mithmitree_SP4\ระบบงานเภสัชกรรม\Mobileapp
cd /d F:\พัฒนา\E-StockScan
```

---

## Run Server

```bash
node server.js
```

---

## Configure Ngrok (First Time Only)

```bash
ngrok config add-authtoken 39a0fXtV2oMWm5T6UP2nP1cujSw_qPR2XfAkVLfUujbTqwFq
```

---

## Check Port 3009

```bash
netstat -ano | findstr :3009
```

Kill process if port already used

```bash
taskkill /PID <PID> /F
```

Example

```bash
taskkill /PID 12345 /F
```

---

# Run Application

## 1. Start Node Server

```bash
node server.js
```

---

## 2. Start Ngrok

Open another terminal

```bash
ngrok http 3009
```

---

## 3. Open Website

```text
https://xxxx.ngrok-free.app/index.html
```

Replace:

```text
xxxx.ngrok-free.app
```

with your real ngrok URL

---

## Project Structure

```text
Mobileapp/
│
├── public/
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── session.html
│   └── session.js
│
├── server.js
├── package.json
├── package-lock.json
└── .gitignore
```


## User Registration / Login

The Emergency Check List now uses Username + Password for login.

### Registration
Registration requires:
- Full name
- Position
- Username
- Password
- Confirm Password
- Phone
- Email
- LINE Login

LINE Login stores:
- LINE_USER_ID
- LINE_DISPLAY_NAME
- LINE_PICTURE_URL

New accounts are created with `STATUS=Pending`. Change the user's status to `Active` in the `USERS` sheet after approval.

### USERS sheet

Run:

```bash
node scripts/setupUsersSheet.js
```

The expected headers are:

```text
USER_ID
FULL_NAME
POSITION
USERNAME
PASSWORD_HASH
PHONE
EMAIL
LINE_USER_ID
LINE_DISPLAY_NAME
LINE_PICTURE_URL
STATUS
CREATED_AT
```

### LINE configuration

Create a LINE Login channel and a LIFF app, then set:

```env
LINE_CHANNEL_ID=your_channel_id
LINE_LIFF_ID=your_liff_id
```

The LIFF app should use the same LINE Login channel. The application sends the LIFF ID token to the server, which verifies it with LINE before registration.

### Security

Passwords are stored as `scrypt` hashes and are never stored as plain text.

Set a strong random value for:

```env
SESSION_SECRET=...
```

Do not commit `.env` or `service-account.json`.
