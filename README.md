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
