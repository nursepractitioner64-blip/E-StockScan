# User Management / Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure Admin User Management workflow that lists registered users, allows Admin to Approve/Reject/Activate/Deactivate accounts, and makes Login honor the resulting account status.

**Architecture:** Keep Google Sheets as the USERS data store and the existing signed HttpOnly cookie session as the authentication mechanism. Add a persistent `ROLE` field to USERS, require an authenticated `ADMIN` role for management APIs, expose focused user-management endpoints, and add an Admin-only management view without changing the existing Emergency Check List flow or LINE integration.

**Tech Stack:** Node.js 24, Express 4, Google Sheets API, vanilla HTML/CSS/JavaScript, SweetAlert2, existing HttpOnly cookie session.

**Spec:** Approved in-chat USER MANAGEMENT / APPROVAL design on 2026-09-20.

## Global Constraints

- Google Sheet `USERS` remains the source of truth for accounts.
- New registrations remain `STATUS = Pending` until an Admin approves them.
- Only `STATUS = Active` accounts may log in.
- Admin APIs must enforce role server-side; hiding buttons in the browser is not authorization.
- LINE fields remain present but are not connected in this implementation.
- Existing Emergency Check List session flow must continue to use the authenticated user and must not reintroduce `user` query-string authentication.
- Passwords remain stored as hashes; plaintext passwords must never be written to Google Sheets.
- Existing USERS data must be preserved during schema migration.

## Review Focus

- A non-admin authenticated user calls an admin endpoint: expect HTTP 403 and no sheet mutation.
- A pending user attempts Login: expect HTTP 403 with the existing pending-account message and no auth cookie.
- Approving an existing pending user: expect exactly one USERS row status change to `Active`.
- Rejecting/deactivating an existing user: expect Login to remain blocked.
- Repeated Approve/Reject requests or an unknown USER_ID: expect a safe response with no duplicate rows or accidental mutation.

---

### Task 1: Align the USERS schema and row helpers

**Files:**
- Modify: `scripts/setupUsersSheet.js`
- Modify: `server.js`

**Interfaces:**
- `USERS_HEADERS` must include the current registration fields plus `ROLE`.
- `rowToUser(row)` continues returning a normalized object keyed by `USERS_HEADERS`.
- Add a reusable `updateUserRow(userId, patch)` helper that finds the exact USERS row and updates only requested columns.

- [ ] **Step 1: Define the target USERS header**

Use this order for the current registration model:

```js
const USERS_HEADERS = [
  "USER_ID",
  "FULL_NAME_TH",
  "FULL_NAME_EN",
  "POSITION",
  "EMPLOYMENT_TYPE",
  "USERNAME",
  "PASSWORD_HASH",
  "PHONE",
  "EMAIL",
  "LINE_USER_ID",
  "LINE_DISPLAY_NAME",
  "LINE_PICTURE_URL",
  "STATUS",
  "ROLE",
  "CREATED_AT"
];
```

If the live sheet already uses a different approved order, preserve its existing order and add only the missing `ROLE` column; do not reorder existing data blindly.

- [ ] **Step 2: Update `scripts/setupUsersSheet.js`**

Make the setup script recognize the target header, add the missing `ROLE` column safely, and preserve all existing rows. Do not delete or rewrite the USERS data just to change the header.

- [ ] **Step 3: Add row lookup/update helpers in `server.js`**

Implement helpers equivalent to:

```js
async function findUserRowById(userId) {}
async function updateUserRow(userId, patch) {}
```

`findUserRowById` must return the 1-based Google Sheets row number and current user object. `updateUserRow` must use `values.update` on only the required cell range(s), not append a second user row.

- [ ] **Step 4: Default existing users safely**

When loading users, treat a missing `ROLE` as `USER` rather than granting Admin privileges. New registrations must also default to `USER`.

- [ ] **Step 5: Run schema verification**

Run:

```powershell
node scripts/setupUsersSheet.js
```

Expected: the USERS schema is reported ready, existing registration records remain present, and no password hashes or rows are lost.

---

### Task 2: Add server-side Admin authorization

**Files:**
- Modify: `server.js`

**Interfaces:**
- `requireAuth(req, res, next)` remains the base authentication middleware.
- Add `requireAdmin(req, res, next)` that calls `getCurrentUser(req)` and requires `ROLE === "ADMIN"`.

- [ ] **Step 1: Extend the session payload**

Update `setAuthCookie(res, user)` to include:

```js
role: String(user.ROLE || "USER").toUpperCase()
```

Do not include password hashes or other secrets in the token.

- [ ] **Step 2: Implement `requireAdmin`**

Use this behavior:

```js
function requireAdmin(req, res, next) {
  const user = getCurrentUser(req);

  if (!user) {
    return res.status(401).json({
      success: false,
      code: "AUTH_REQUIRED",
      message: "กรุณาเข้าสู่ระบบ"
    });
  }

  if (String(user.role || "").toUpperCase() !== "ADMIN") {
    return res.status(403).json({
      success: false,
      code: "ADMIN_REQUIRED",
      message: "คุณไม่มีสิทธิ์จัดการผู้ใช้งาน"
    });
  }

  req.user = user;
  next();
}
```

The implementation must not trust a browser-provided role.

- [ ] **Step 3: Return role from `/api/auth/me` and login**

Expose `ROLE`/`role` in the safe user object returned to the browser. Never expose `PASSWORD_HASH`.

- [ ] **Step 4: Test authorization manually**

With a normal USER session, call an admin endpoint and expect `403 ADMIN_REQUIRED`. With no session, expect `401 AUTH_REQUIRED`.

---

### Task 3: Make registration create a non-admin Pending user

**Files:**
- Modify: `server.js`
- Modify: `public/index.html` (only if the current live registration payload needs field-name alignment)

**Interfaces:**
- `POST /api/auth/register` continues accepting the current registration fields.
- Newly created records produce `STATUS = "Pending"` and `ROLE = "USER"`.

- [ ] **Step 1: Verify current registration payload**

The registration payload must contain the current fields:

```js
{
  full_name_th,
  full_name_en,
  position,
  employment_type,
  username,
  password,
  confirm_password,
  phone,
  email,
  line_user_id: null,
  line_display_name: null,
  line_picture_url: null
}
```

If the live page still sends legacy `full_name`, normalize it server-side only if necessary, while retaining the new Thai/English fields.

- [ ] **Step 2: Set the default role**

Create users with:

```js
STATUS: "Pending",
ROLE: "USER"
```

- [ ] **Step 3: Preserve current validation**

Continue validating required fields, password confirmation, minimum 8 characters, email format, and duplicate username/LINE ID rules.

- [ ] **Step 4: Test registration**

Register a test account and verify the USERS row contains `Pending` and `USER`.

---

### Task 4: Add User Management API

**Files:**
- Modify: `server.js`

**Interfaces:**
- `GET /api/admin/users`
- `PATCH /api/admin/users/:userId/approve`
- `PATCH /api/admin/users/:userId/reject`
- `PATCH /api/admin/users/:userId/status`

- [ ] **Step 1: Add `GET /api/admin/users`**

Return safe user records without `PASSWORD_HASH`. Support optional `status` and `q` query parameters for server-side filtering:

```text
GET /api/admin/users?status=Pending&q=thanachanan
```

Return:

```js
{
  success: true,
  users: [
    {
      USER_ID,
      FULL_NAME_TH,
      FULL_NAME_EN,
      POSITION,
      EMPLOYMENT_TYPE,
      USERNAME,
      PHONE,
      EMAIL,
      STATUS,
      ROLE,
      LINE_USER_ID,
      LINE_DISPLAY_NAME,
      LINE_PICTURE_URL,
      CREATED_AT
    }
  ]
}
```

- [ ] **Step 2: Add Approve endpoint**

`PATCH /api/admin/users/:userId/approve` changes only the target row to:

```text
STATUS = Active
```

Do not create another row.

- [ ] **Step 3: Add Reject endpoint**

`PATCH /api/admin/users/:userId/reject` changes only:

```text
STATUS = Rejected
```

- [ ] **Step 4: Add generic status endpoint**

`PATCH /api/admin/users/:userId/status` accepts only these values:

```text
Active
Rejected
Inactive
```

Reject unknown statuses with HTTP 400.

- [ ] **Step 5: Protect every endpoint with `requireAdmin`**

No admin endpoint may be reachable through a client-only check.

- [ ] **Step 6: Test API state transitions**

Verify:

```text
Pending -> Active
Pending -> Rejected
Active  -> Inactive
Inactive -> Active
```

and verify the same USERS row changes in Google Sheets.

---

### Task 5: Enforce status and role during Login

**Files:**
- Modify: `server.js`

**Interfaces:**
- `POST /api/auth/login` keeps the current request shape and response contract, with safe role information added.

- [ ] **Step 1: Preserve password verification first**

Find the user by username, verify the password hash, then evaluate status. Do not reveal whether a username exists when password verification fails.

- [ ] **Step 2: Keep Pending blocked**

Return HTTP 403 with `USER_NOT_ACTIVE` and message:

```text
บัญชียังรอผู้ดูแลอนุมัติ
```

- [ ] **Step 3: Keep Rejected/Inactive blocked**

Return HTTP 403 with a clear status-safe message and do not issue an auth cookie.

- [ ] **Step 4: Allow Active users**

Only `STATUS = Active` receives the HttpOnly auth cookie.

- [ ] **Step 5: Test the full login matrix**

Verify Pending, Active, Rejected, and Inactive accounts independently.

---

### Task 6: Build the Admin User Management page

**Files:**
- Create: `public/admin-users.html`
- Create: `public/admin-users.js`
- Create: `public/admin-users.css`
- Modify: `public/index.html` only if an Admin navigation entry is desired

**Interfaces:**
- Browser consumes `/api/auth/me` and `/api/admin/users`.
- Browser calls the three management mutation endpoints.

- [ ] **Step 1: Create the page shell**

Provide:

```text
USER MANAGEMENT

[ Search __________________ ] [ Status ▼ ]

Pending | Active | Rejected | Inactive

Table
```

- [ ] **Step 2: Render the user table**

Columns:

```text
ชื่อไทย
ชื่ออังกฤษ
Username
ตำแหน่ง
การจ้างงาน
โทรศัพท์
Email
สถานะ
Action
```

Do not display password hashes.

- [ ] **Step 3: Add action buttons**

For Pending:

```text
Approve
Reject
```

For Active:

```text
Deactivate
```

For Rejected/Inactive:

```text
Activate
```

- [ ] **Step 4: Confirm destructive/status actions**

Use SweetAlert2 confirmation before Reject, Deactivate, or reactivation.

- [ ] **Step 5: Restrict the page in the browser**

Call `/api/auth/me`. If not authenticated, return to the login page. If not ADMIN, show a permission message and do not render management controls. This is UX only; API authorization remains the real security boundary.

- [ ] **Step 6: Add refresh behavior**

After every successful status mutation, reload the table from the server instead of modifying only the local row.

---

### Task 7: Connect Admin entry to the existing Emergency Check List login flow

**Files:**
- Modify: `public/index.html`
- Modify: `public/style.css` only if needed

**Interfaces:**
- Active Admin sees an `👥 User Management` button.
- Normal users do not see the Admin button.

- [ ] **Step 1: Show Admin navigation only for ROLE = ADMIN**

When `showDashboard(user)` runs, toggle the Admin button based on the authenticated user's role.

- [ ] **Step 2: Navigate to `admin-users.html`**

Do not put role or user identity into the URL as an authorization mechanism.

- [ ] **Step 3: Preserve existing Start Emergency Check List and Logout behavior**

No regression to `/api/session/new`, `/api/auth/logout`, or authenticated session behavior.

---

### Task 8: End-to-end verification

**Files:**
- No production file changes unless a test exposes a defect.
- Test: PowerShell HTTP checks against the running server.

**Interfaces:**
- Google Sheets USERS sheet.
- Auth and admin HTTP endpoints.

- [ ] **Step 1: Restart the server cleanly**

Because port `3009` has previously produced `EADDRINUSE`, stop the existing Node process before starting a single server instance.

- [ ] **Step 2: Verify unauthenticated behavior**

```powershell
Invoke-WebRequest http://localhost:3009/api/auth/me -UseBasicParsing
```

Expected: `401`.

- [ ] **Step 3: Register a test user**

Verify the API returns `201`, and the sheet contains `Pending / USER`.

- [ ] **Step 4: Verify Pending Login is blocked**

Expected: `403 USER_NOT_ACTIVE`.

- [ ] **Step 5: Log in as Admin**

Verify `/api/auth/me` reports `ROLE = ADMIN`.

- [ ] **Step 6: Approve the test user**

Verify the exact USERS row changes from `Pending` to `Active`.

- [ ] **Step 7: Log in as the approved user**

Expected: successful login and auth cookie.

- [ ] **Step 8: Verify Admin-only access**

Use a normal USER session against `/api/admin/users` and expect `403`.

- [ ] **Step 9: Verify Emergency Check List session**

Start a check-list session while logged in and verify the server associates it with the authenticated user rather than trusting a `user` query parameter.

- [ ] **Step 10: Verify LINE remains untouched**

Registration must continue storing blank LINE fields until the later LINE/LIFF step.

