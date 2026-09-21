# USER MANAGEMENT / APPROVAL

## 1. Update the USERS schema

Run this once against the same Google Sheet used by the server:

```powershell
node scripts/setupUsersSheet.js
```

The target columns are:

```text
USER_ID
FULL_NAME_TH
FULL_NAME_EN
POSITION
EMPLOYMENT_TYPE
USERNAME
PASSWORD_HASH
PHONE
EMAIL
LINE_USER_ID
LINE_DISPLAY_NAME
LINE_PICTURE_URL
STATUS
ROLE
CREATED_AT
```

Existing users are preserved. Missing `ROLE` values become `USER`.

## 2. Bootstrap the first Admin

Do this only for the account you intentionally want to administer the system.

```powershell
node scripts/setUserRole.js thanachanan.k ADMIN Active
```

This changes only that user's `ROLE` and `STATUS` in the USERS sheet.

## 3. Start the server

```powershell
node server.js
```

The default port is `3009`.

## 4. Admin flow

1. Login with the Admin account.
2. Click `👥 User Management`.
3. Open Pending users.
4. Approve or Reject.
5. Approved users become `Active` and can Login.

## 5. Important

- New Registration always creates `STATUS = Pending` and `ROLE = USER`.
- Only `Active` users can Login.
- Admin APIs are protected server-side with `requireAdmin`.
- Password hashes are never returned by the API.
- LINE fields remain available but are not required for Registration in this step.
