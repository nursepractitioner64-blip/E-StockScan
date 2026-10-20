require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { google } = require("googleapis");

const app = express();

app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  credentials: true
}));
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const SHEET_ID =
  process.env.GOOGLE_SHEET_ID ||
  "1BYT5Qr65c-t72SWBP4h6vaxj8SxB7Vr8qeU-rQHB0S4";

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
  "CREATED_AT",
  "BRANCH_IDS"
];

const MOVEMENT_SCHEMA = [
  "movement_id", "type", "ref_no", "date",
  "code", "name", "qty", "unit",
  "lot", "exp", "target", "user",
  "time", "remark", "location", "qrcode"
];

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: String(process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

function assertGoogleConfig() {
  if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error("Google Sheets credentials are not configured.");
  }
}

async function sheetsApi() {
  assertGoogleConfig();
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

async function getValues(range) {
  const sheets = await sheetsApi();
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range
  });
  return result.data.values || [];
}

async function ensureSheet(name, header = []) {
  const sheets = await sheetsApi();

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID
  });

  const existing = meta.data.sheets.find(
    s => s.properties.title === name
  );

  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          { addSheet: { properties: { title: name } } }
        ]
      }
    });

    if (header.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${name}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [header] }
      });
    }
    return;
  }

  if (!header.length) return;

  const rows = await getValues(`${name}!1:1`);
  if (!rows.length || !rows[0].length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${name}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [header] }
    });
  }
}

/* =========================================
   CLIENT CONFIG
========================================= */

app.get("/api/config", (req, res) => {
  res.json({
    success: true,
    liff_id: process.env.LINE_LIFF_ID || ""
  });
});

/* =========================================
   AUTH HELPERS
========================================= */

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  process.env.JWT_SECRET ||
  "CHANGE_THIS_SESSION_SECRET_IN_ENV";

function base64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function signSession(payload) {
  const body = base64url(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(body)
    .digest("base64url");

  return `${body}.${signature}`;
}

function verifySessionToken(token) {
  if (!token || !token.includes(".")) return null;

  const [body, signature] = token.split(".");
  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(body)
    .digest("base64url");

  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    )
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    );

    if (!payload.exp || payload.exp < Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return header.split(";").reduce((out, part) => {
    const index = part.indexOf("=");
    if (index < 0) return out;

    const key = part.slice(0, index).trim();
    const value = decodeURIComponent(part.slice(index + 1).trim());

    out[key] = value;
    return out;
  }, {});
}

function setAuthCookie(res, user) {
  const token = signSession({
    user_id: user.USER_ID,
    username: user.USERNAME,
    full_name: user.FULL_NAME_TH || user.FULL_NAME_EN || user.FULL_NAME || "",
    full_name_th: user.FULL_NAME_TH || "",
    full_name_en: user.FULL_NAME_EN || "",
    position: user.POSITION || "",
    employment_type: user.EMPLOYMENT_TYPE || "",
    role: String(user.ROLE || "USER").toUpperCase(),
    exp: Date.now() + 8 * 60 * 60 * 1000
  });

  res.setHeader(
    "Set-Cookie",
    `auth_token=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800`
  );
}

function clearAuthCookie(res) {
  res.setHeader(
    "Set-Cookie",
    "auth_token=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
  );
}

function getCurrentUser(req) {
  const cookies = parseCookies(req);
  return verifySessionToken(cookies.auth_token);
}

function requireAuth(req, res, next) {
  const user = getCurrentUser(req);

  if (!user) {
    return res.status(401).json({
      success: false,
      code: "AUTH_REQUIRED",
      message: "กรุณาเข้าสู่ระบบ"
    });
  }

  req.user = user;
  next();
}

async function requireAdmin(req, res, next) {
  const sessionUser = getCurrentUser(req);

  if (!sessionUser) {
    return res.status(401).json({
      success: false,
      code: "AUTH_REQUIRED",
      message: "กรุณาเข้าสู่ระบบ"
    });
  }

  try {
    const users = await getUsers();
    const current = users.find(u =>
      String(u.USER_ID) === String(sessionUser.user_id)
    );

    if (!current || String(current.STATUS).toLowerCase() !== "active") {
      return res.status(403).json({
        success: false,
        code: "ADMIN_REQUIRED",
        message: "คุณไม่มีสิทธิ์จัดการผู้ใช้งาน"
      });
    }

    if (String(current.ROLE || "USER").toUpperCase() !== "ADMIN") {
      return res.status(403).json({
        success: false,
        code: "ADMIN_REQUIRED",
        message: "คุณไม่มีสิทธิ์จัดการผู้ใช้งาน"
      });
    }

    req.user = {
      ...sessionUser,
      role: "ADMIN",
      ROLE: "ADMIN"
    };
    req.currentUserRecord = current;
    next();
  } catch (err) {
    console.error("ADMIN AUTH ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "ไม่สามารถตรวจสอบสิทธิ์ Admin ได้"
    });
  }
}

/* =========================================
   PASSWORD
========================================= */

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");

    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);

      resolve(
        `scrypt:${salt}:${derivedKey.toString("hex")}`
      );
    });
  });
}

function verifyPassword(password, stored) {
  return new Promise(resolve => {
    const value = String(stored || "");
    let parts;
    if (value.startsWith("scrypt:")) parts = value.split(":");
    else if (value.startsWith("scrypt$")) parts = value.split("$");
    else return resolve(false);

    if (parts.length !== 3 || parts[0] !== "scrypt" || !parts[1] || !/^[a-f0-9]+$/i.test(parts[2] || "")) {
      return resolve(false);
    }

    const salt = parts[1];
    const expected = Buffer.from(parts[2], "hex");

    crypto.scrypt(String(password), salt, expected.length, (err, derived) => {
      if (err || !derived || derived.length !== expected.length) return resolve(false);
      resolve(crypto.timingSafeEqual(derived, expected));
    });
  });
}

/* =========================================
   PASSWORD RESET - PHASE 1
   In-memory reset token
   No Email / No Schema Change
========================================= */

const passwordResetTokens = new Map();

const PASSWORD_RESET_EXPIRE_MS =
  15 * 60 * 1000;


/*
  Create secure random token
*/
function createPasswordResetToken() {

  return crypto
    .randomBytes(32)
    .toString("hex");

}


/*
  Hash reset token before storing it
*/
function hashResetToken(token) {

  return crypto
    .createHash("sha256")
    .update(String(token))
    .digest("hex");

}


/*
  Remove expired reset tokens
*/
function cleanupPasswordResetTokens() {

  const now = Date.now();

  for (const [
    tokenHash,
    data
  ] of passwordResetTokens.entries()) {

    if (
      !data.expiresAt ||
      data.expiresAt <= now
    ) {

      passwordResetTokens.delete(
        tokenHash
      );

    }

  }

}


/*
  Create password reset request
*/
function createPasswordResetRequest(user) {

  cleanupPasswordResetTokens();

  /*
    One user = one active reset token
  */

  for (
    const [
      tokenHash,
      data
    ] of passwordResetTokens.entries()
  ) {

    if (
      String(data.userId) ===
      String(user.USER_ID)
    ) {

      passwordResetTokens.delete(
        tokenHash
      );

    }

  }


  const token =
    createPasswordResetToken();

  const tokenHash =
    hashResetToken(token);

  const expiresAt =
    Date.now() +
    PASSWORD_RESET_EXPIRE_MS;


  passwordResetTokens.set(
    tokenHash,
    {
      userId:
        user.USER_ID,

      username:
        user.USERNAME,

      expiresAt
    }
  );


  return {
    token,
    expiresAt
  };

}


/*
  Consume reset token
  Token is deleted immediately
  so it can only be used once
*/
function consumePasswordResetToken(token) {

  cleanupPasswordResetTokens();

  const safeToken =
    String(token || "").trim();


  if (!safeToken) {

    return null;

  }


  const tokenHash =
    hashResetToken(safeToken);


  const data =
    passwordResetTokens.get(
      tokenHash
    );


  if (!data) {

    return null;

  }


  /*
    One-time use
  */
  passwordResetTokens.delete(
    tokenHash
  );


  if (
    !data.expiresAt ||
    data.expiresAt <= Date.now()
  ) {

    return null;

  }


  return data;

}

function rowToUser(row) {
  const user = {};

  USERS_HEADERS.forEach((header, index) => {
    user[header] = row[index] || "";
  });

  return user;
}

async function getUsers() {
  await ensureSheet("USERS", USERS_HEADERS);

  const rows = await getValues("USERS!A:P");

  if (!rows.length) return [];

  return rows.slice(1).map(rowToUser);
}

async function appendUser(user) {
  const sheets = await sheetsApi();

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "USERS!A:P",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [USERS_HEADERS.map(header => user[header] ?? "")]
    }
  });
}

async function findUserRowById(userId) {
  const rows = await getValues("USERS!A:P");
  const target = String(userId || "").trim();

  for (let index = 1; index < rows.length; index += 1) {
    if (String(rows[index][0] || "").trim() === target) {
      return {
        rowNumber: index + 1,
        user: rowToUser(rows[index])
      };
    }
  }

  return null;
}

async function updateUserRow(userId, patch) {
  const found = await findUserRowById(userId);

  if (!found) return null;

  const updates = [];
  for (const [key, value] of Object.entries(patch || {})) {
    const index = USERS_HEADERS.indexOf(key);
    if (index < 0) continue;

    updates.push({
      range: `USERS!${columnLetter(index + 1)}${found.rowNumber}`,
      values: [[value ?? ""]]
    });
  }

  if (!updates.length) return found.user;

  const sheets = await sheetsApi();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "RAW",
      data: updates
    }
  });

  return { ...found.user, ...patch };
}

function columnLetter(number) {
  let result = "";
  let n = number;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function safeUser(user) {
  if (!user) return null;

  return {
    USER_ID: user.USER_ID,
    FULL_NAME_TH: user.FULL_NAME_TH || user.FULL_NAME || "",
    FULL_NAME_EN: user.FULL_NAME_EN || "",
    POSITION: user.POSITION || "",
    EMPLOYMENT_TYPE: user.EMPLOYMENT_TYPE || "",
    USERNAME: user.USERNAME || "",
    PHONE: user.PHONE || "",
    EMAIL: user.EMAIL || "",
    STATUS: user.STATUS || "Pending",
    ROLE: String(user.ROLE || "USER").toUpperCase(),
    LINE_USER_ID: user.LINE_USER_ID || "",
    LINE_DISPLAY_NAME: user.LINE_DISPLAY_NAME || "",
    LINE_PICTURE_URL: user.LINE_PICTURE_URL || "",
    CREATED_AT: user.CREATED_AT || ""
  };
}

/* =========================================
   LINE LIFF / ID TOKEN
========================================= */

async function verifyLineIdToken(idToken) {
  const token = String(idToken || "").trim();
  if (!token) {
    const error = new Error("กรุณาเชื่อมต่อบัญชี LINE ก่อนสมัคร");
    error.status = 400;
    throw error;
  }

  const channelId = String(process.env.LINE_CHANNEL_ID || "").trim();
  if (!channelId) {
    const error = new Error("ยังไม่ได้ตั้งค่า LINE_CHANNEL_ID บน Server");
    error.status = 503;
    throw error;
  }

  const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: token, client_id: channelId })
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.sub) {
    const error = new Error("LINE Token ไม่ถูกต้องหรือหมดอายุ กรุณาเชื่อมต่อ LINE ใหม่");
    error.status = 401;
    throw error;
  }

  return {
    user_id: String(data.sub),
    display_name: String(data.name || ""),
    picture_url: String(data.picture || "")
  };
}

app.post("/api/auth/line/verify", async (req, res) => {
  try {
    const line = await verifyLineIdToken(req.body?.id_token);
    return res.json({ success: true, line });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    console.error("LINE VERIFY ERROR:", err);
    return res.status(500).json({ success: false, message: "ตรวจสอบ LINE ไม่สำเร็จ" });
  }
});

/* =========================================
   LINK LINE TO AN EXISTING ACCOUNT
   Requires an active, authenticated account.
========================================= */
app.get("/api/auth/line/status", requireAuth, async (req, res) => {
  try {
    const users = await getUsers();
    const current = users.find(u => String(u.USER_ID) === String(req.user.user_id));
    if (!current || String(current.STATUS || "").toLowerCase() !== "active") {
      return res.status(403).json({ success: false, message: "บัญชีนี้ยังไม่สามารถใช้งานได้" });
    }
    return res.json({
      success: true,
      linked: Boolean(String(current.LINE_USER_ID || "").trim()),
      display_name: String(current.LINE_DISPLAY_NAME || "")
    });
  } catch (err) {
    console.error("LINE LINK STATUS ERROR:", err);
    return res.status(500).json({ success: false, message: "ตรวจสอบสถานะ LINE ไม่สำเร็จ" });
  }
});

app.post("/api/auth/line/link", requireAuth, async (req, res) => {
  try {
    const line = await verifyLineIdToken(req.body?.id_token);
    const users = await getUsers();
    const current = users.find(u => String(u.USER_ID) === String(req.user.user_id));
    if (!current || String(current.STATUS || "").toLowerCase() !== "active") {
      return res.status(403).json({ success: false, message: "บัญชีนี้ยังไม่สามารถใช้งานได้" });
    }

    const existingLineId = String(current.LINE_USER_ID || "").trim();
    if (existingLineId && existingLineId !== line.user_id) {
      return res.status(409).json({ success: false, message: "บัญชีนี้ผูกกับ LINE อื่นอยู่แล้ว กรุณาติดต่อ Admin หากต้องการเปลี่ยนบัญชี LINE" });
    }

    const duplicate = users.find(u =>
      String(u.USER_ID) !== String(current.USER_ID) &&
      String(u.LINE_USER_ID || "").trim() === line.user_id
    );
    if (duplicate) {
      return res.status(409).json({ success: false, message: "บัญชี LINE นี้ผูกกับผู้ใช้งานอื่นแล้ว ไม่สามารถผูกซ้ำได้" });
    }

    if (!existingLineId) {
      const updated = await updateUserRow(current.USER_ID, {
        LINE_USER_ID: line.user_id,
        LINE_DISPLAY_NAME: line.display_name,
        LINE_PICTURE_URL: line.picture_url
      });
      if (!updated) return res.status(404).json({ success: false, message: "ไม่พบบัญชีผู้ใช้งานเดิม" });
    } else {
      // Same LINE identity: refresh profile fields without changing the account.
      await updateUserRow(current.USER_ID, {
        LINE_DISPLAY_NAME: line.display_name,
        LINE_PICTURE_URL: line.picture_url
      });
    }

    return res.json({
      success: true,
      linked: true,
      message: existingLineId ? "บัญชีนี้เชื่อมต่อ LINE อยู่แล้ว" : "ผูกบัญชี LINE กับบัญชีเดิมสำเร็จ",
      display_name: line.display_name
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    console.error("LINE LINK ERROR:", err);
    return res.status(500).json({ success: false, message: "ผูกบัญชี LINE ไม่สำเร็จ กรุณาลองใหม่" });
  }
});

/* =========================================
   REGISTER
========================================= */

app.post("/api/auth/register", async (req, res) => {
  try {
    const body = req.body || {};
    // LINE identity is always derived from a server-verified ID token; never trust browser-supplied LINE IDs.
    const verifiedLine = await verifyLineIdToken(body.id_token);

    const fullNameTh = String(body.full_name_th || body.fullNameTh || body.full_name || "").trim();
    const fullNameEn = String(body.full_name_en || body.fullNameEn || "").trim();
    const positionValue = String(body.position || "").trim();
    const employmentType = String(body.employment_type || body.employmentType || "").trim();
    const safeUsername = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const confirmPassword = String(body.confirm_password || body.confirmPassword || "");
    const safePhone = String(body.phone || "").trim();
    const safeEmail = String(body.email || "").trim();
    const lineUserId = verifiedLine.user_id;
    const lineDisplayName = verifiedLine.display_name;
    const linePictureUrl = verifiedLine.picture_url;

    if (
      !fullNameTh ||
      !fullNameEn ||
      !positionValue ||
      !employmentType ||
      !safeUsername ||
      !password ||
      !confirmPassword ||
      !safePhone ||
      !safeEmail
    ) {
      return res.status(400).json({
        success: false,
        message: "กรุณากรอกข้อมูลให้ครบถ้วน"
      });
    }

    if (!password || password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Password และ Confirm Password ไม่ตรงกัน"
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password ต้องมีอย่างน้อย 8 ตัวอักษร"
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail)) {
      return res.status(400).json({
        success: false,
        message: "รูปแบบ Email ไม่ถูกต้อง"
      });
    }

    if (!/^(Register Nurse|Public Health)$/.test(positionValue)) {
      return res.status(400).json({
        success: false,
        message: "ตำแหน่งไม่ถูกต้อง"
      });
    }

    if (!/^(Full-Time|Part-Time)$/.test(employmentType)) {
      return res.status(400).json({
        success: false,
        message: "ประเภทการจ้างงานไม่ถูกต้อง"
      });
    }

    const users = await getUsers();

    if (users.some(u =>
      String(u.USERNAME).toLowerCase() === safeUsername
    )) {
      return res.status(409).json({
        success: false,
        message: "Username นี้ถูกใช้งานแล้ว"
      });
    }

    if (lineUserId && users.some(u =>
      String(u.LINE_USER_ID) === lineUserId
    )) {
      return res.status(409).json({
        success: false,
        message: "LINE นี้ลงทะเบียนไว้แล้ว"
      });
    }

    const passwordHash = await hashPassword(password);

    const user = {
      USER_ID: `U${Date.now()}${crypto.randomInt(100, 999)}`,
      FULL_NAME_TH: fullNameTh,
      FULL_NAME_EN: fullNameEn,
      POSITION: positionValue,
      EMPLOYMENT_TYPE: employmentType,
      USERNAME: safeUsername,
      PASSWORD_HASH: passwordHash,
      PHONE: safePhone,
      EMAIL: safeEmail,
      LINE_USER_ID: lineUserId,
      LINE_DISPLAY_NAME: lineDisplayName,
      LINE_PICTURE_URL: linePictureUrl,
      STATUS: "Pending",
      ROLE: "USER",
      CREATED_AT: new Date().toISOString(),
      BRANCH_IDS: ""
    };

    await appendUser(user);

    return res.status(201).json({
      success: true,
      message: "ลงทะเบียนสำเร็จ กรุณารอผู้ดูแลอนุมัติ",
      user: safeUser(user)
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    console.error("REGISTER ERROR:", err);

    res.status(500).json({
      success: false,
      message: "สมัครสมาชิกไม่สำเร็จ กรุณาลองใหม่"
    });
  }
});


/* =========================================
   FORGOT PASSWORD
   PHASE 1
   No Email
========================================= */

app.post(
  "/api/auth/forgot-password",
  async (req, res) => {

    try {

      const identifier =
        String(
          req.body?.identifier || ""
        ).trim();


      if (!identifier) {

        return res.status(400).json({

          success: false,

          message:
            "กรุณากรอก Username หรือ Email"

        });

      }


      const users =
        await getUsers();


      const lookup =
        identifier.toLowerCase();


      const user =
        users.find(u => {

          const username =
            String(
              u.USERNAME || ""
            )
              .trim()
              .toLowerCase();


          const email =
            String(
              u.EMAIL || ""
            )
              .trim()
              .toLowerCase();


          return (
            username === lookup ||
            email === lookup
          );

        });


      /*
        Do not allow reset for unknown user
      */

      if (!user) {

        return res.status(404).json({

          success: false,

          message:
            "ไม่พบ Username หรือ Email นี้ในระบบ"

        });

      }


      /*
        Only Active / Pending users
        can request reset.
      */

      const status =
        String(
          user.STATUS || ""
        )
          .trim()
          .toLowerCase();


      if (
        status !== "active" &&
        status !== "pending"
      ) {

        return res.status(403).json({

          success: false,

          message:
            "บัญชีนี้ไม่สามารถรีเซ็ตรหัสผ่านได้"

        });

      }


      const reset =
        createPasswordResetRequest(
          user
        );


      /*
        PHASE 1
        No email yet.
        Return URL for testing.
      */

      const resetUrl =
        `/reset-password.html?token=${
          encodeURIComponent(
            reset.token
          )
        }`;


      console.log("");
      console.log(
        "============================================"
      );
      console.log(
        " PASSWORD RESET REQUEST"
      );
      console.log(
        "============================================"
      );
      console.log(
        "USER:",
        user.USERNAME
      );
      console.log(
        "EMAIL:",
        user.EMAIL
      );
      console.log(
        "EXPIRES:",
        new Date(
          reset.expiresAt
        ).toISOString()
      );
      console.log(
        "RESET URL:",
        resetUrl
      );
      console.log(
        "============================================"
      );
      console.log("");


      return res.json({

        success: true,

        message:
          "สร้างคำขอเปลี่ยนรหัสผ่านแล้ว",

        username:
          user.USERNAME,

        reset_url:
          resetUrl,

        expires_in:
          PASSWORD_RESET_EXPIRE_MS /
          1000

      });


    } catch (err) {

      console.error(
        "FORGOT PASSWORD ERROR:",
        err
      );


      return res.status(500).json({

        success: false,

        message:
          "ไม่สามารถสร้างคำขอเปลี่ยนรหัสผ่านได้"

      });

    }

  }
);


/* =========================================
   VERIFY RESET TOKEN
========================================= */

app.get(
  "/api/auth/reset-password/verify",
  (req, res) => {

    try {

      cleanupPasswordResetTokens();


      const token =
        String(
          req.query.token || ""
        ).trim();


      if (!token) {

        return res.status(400).json({

          success: false,

          message:
            "ไม่พบ Reset Token"

        });

      }


      const tokenHash =
        hashResetToken(token);


      const data =
        passwordResetTokens.get(
          tokenHash
        );


      if (!data) {

        return res.status(400).json({

          success: false,

          message:
            "Reset Link ไม่ถูกต้อง หรือหมดอายุแล้ว"

        });

      }


      if (
        !data.expiresAt ||
        data.expiresAt <= Date.now()
      ) {

        passwordResetTokens.delete(
          tokenHash
        );


        return res.status(400).json({

          success: false,

          message:
            "Reset Link หมดอายุแล้ว"

        });

      }


      return res.json({

        success: true,

        username:
          data.username,

        expires_at:
          new Date(
            data.expiresAt
          ).toISOString()

      });


    } catch (err) {

      console.error(
        "VERIFY RESET TOKEN ERROR:",
        err
      );


      return res.status(500).json({

        success: false,

        message:
          "ไม่สามารถตรวจสอบ Reset Token ได้"

      });

    }

  }
);


/* =========================================
   RESET PASSWORD
========================================= */

app.post(
  "/api/auth/reset-password",
  async (req, res) => {

    try {

      const token =
        String(
          req.body?.token || ""
        ).trim();


      const password =
        String(
          req.body?.password || ""
        );


      const confirmPassword =
        String(
          req.body?.confirm_password || ""
        );


      if (!token) {

        return res.status(400).json({

          success: false,

          message:
            "ไม่พบ Reset Token"

        });

      }


      if (!password) {

        return res.status(400).json({

          success: false,

          message:
            "กรุณากรอก Password ใหม่"

        });

      }


      if (
        password.length < 8
      ) {

        return res.status(400).json({

          success: false,

          message:
            "Password ต้องมีอย่างน้อย 8 ตัวอักษร"

        });

      }


      if (
        password !==
        confirmPassword
      ) {

        return res.status(400).json({

          success: false,

          message:
            "Password และ Confirm Password ไม่ตรงกัน"

        });

      }


      /*
        Validate and consume token
        before modifying password.
      */

      const reset =
        consumePasswordResetToken(
          token
        );


      if (!reset) {

        return res.status(400).json({

          success: false,

          message:
            "Reset Link ไม่ถูกต้อง หมดอายุ หรือถูกใช้งานแล้ว"

        });

      }


      const found =
        await findUserRowById(
          reset.userId
        );


      if (!found) {

        return res.status(404).json({

          success: false,

          message:
            "ไม่พบผู้ใช้งาน"

        });

      }


      const newPasswordHash =
        await hashPassword(
          password
        );


      await updateUserRow(
        reset.userId,
        {
          PASSWORD_HASH:
            newPasswordHash
        }
      );


      console.log(
        "PASSWORD RESET SUCCESS:",
        found.user.USERNAME
      );


      return res.json({

        success: true,

        message:
          "เปลี่ยนรหัสผ่านสำเร็จ",

        username:
          found.user.USERNAME

      });


    } catch (err) {

      console.error(
        "RESET PASSWORD ERROR:",
        err
      );


      return res.status(500).json({

        success: false,

        message:
          "ไม่สามารถเปลี่ยนรหัสผ่านได้"

      });

    }

  }
);

/* =========================================
   LOGIN
========================================= */

app.post("/api/auth/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "กรุณากรอก Username และ Password"
      });
    }

    const users = await getUsers();

    const user = users.find(u =>
      String(u.USERNAME).toLowerCase() === username.toLowerCase()
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Username หรือ Password ไม่ถูกต้อง"
      });
    }

    const valid = await verifyPassword(
      password,
      user.PASSWORD_HASH
    );

    if (!valid) {
      return res.status(401).json({
        success: false,
        message: "Username หรือ Password ไม่ถูกต้อง"
      });
    }

    if (String(user.STATUS).toLowerCase() !== "active") {
      return res.status(403).json({
        success: false,
        code: "USER_NOT_ACTIVE",
        status: user.STATUS,
        message:
          String(user.STATUS).toLowerCase() === "pending"
            ? "บัญชียังรอผู้ดูแลอนุมัติ"
            : "บัญชีนี้ยังไม่สามารถเข้าใช้งานได้"
      });
    }

    setAuthCookie(res, user);

    res.json({
      success: true,
      user: {
        ...safeUser(user)
      }
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);

    res.status(500).json({
      success: false,
      message: "Login failed"
    });
  }
});

app.get("/api/auth/me", (req, res) => {
  const user = getCurrentUser(req);

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "ยังไม่ได้เข้าสู่ระบบ"
    });
  }

  res.json({
    success: true,
    user: {
      ...user,
      role: String(user.role || "USER").toUpperCase(),
      ROLE: String(user.role || "USER").toUpperCase()
    }
  });
});

app.post("/api/auth/logout", (req, res) => {
  clearAuthCookie(res);

  res.json({
    success: true
  });
});

/* =========================================
   ADMIN USER MANAGEMENT
========================================= */

app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const statusFilter = String(req.query.status || "").trim().toLowerCase();
    const query = String(req.query.q || "").trim().toLowerCase();
    const users = await getUsers();

    const filtered = users.filter(user => {
      const matchesStatus = !statusFilter ||
        String(user.STATUS || "").toLowerCase() === statusFilter;

      if (!matchesStatus) return false;
      if (!query) return true;

      return [
        user.FULL_NAME_TH,
        user.FULL_NAME_EN,
        user.USERNAME,
        user.POSITION,
        user.PHONE,
        user.EMAIL
      ].some(value => String(value || "").toLowerCase().includes(query));
    });

    return res.json({
      success: true,
      users: filtered.map(safeUser)
    });
  } catch (err) {
    console.error("ADMIN USERS GET ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "ไม่สามารถโหลดรายชื่อผู้ใช้งานได้"
    });
  }
});

app.patch("/api/admin/users/:userId/approve", requireAdmin, async (req, res) => {
  try {
    const found = await findUserRowById(req.params.userId);

    if (!found) {
      return res.status(404).json({ success: false, message: "ไม่พบผู้ใช้งาน" });
    }

    if (String(found.user.STATUS).toLowerCase() === "active") {
      return res.json({ success: true, message: "ผู้ใช้งาน Active อยู่แล้ว", user: safeUser(found.user) });
    }

    const updated = await updateUserRow(req.params.userId, { STATUS: "Active" });
    return res.json({ success: true, message: "อนุมัติผู้ใช้งานสำเร็จ", user: safeUser(updated) });
  } catch (err) {
    console.error("ADMIN APPROVE ERROR:", err);
    return res.status(500).json({ success: false, message: "ไม่สามารถอนุมัติผู้ใช้งานได้" });
  }
});

app.patch("/api/admin/users/:userId/reject", requireAdmin, async (req, res) => {
  try {
    const found = await findUserRowById(req.params.userId);

    if (!found) {
      return res.status(404).json({ success: false, message: "ไม่พบผู้ใช้งาน" });
    }

    const updated = await updateUserRow(req.params.userId, { STATUS: "Rejected" });
    return res.json({ success: true, message: "ปฏิเสธผู้ใช้งานสำเร็จ", user: safeUser(updated) });
  } catch (err) {
    console.error("ADMIN REJECT ERROR:", err);
    return res.status(500).json({ success: false, message: "ไม่สามารถปฏิเสธผู้ใช้งานได้" });
  }
});

app.patch("/api/admin/users/:userId/status", requireAdmin, async (req, res) => {
  try {
    const status = String(req.body?.status || "").trim();
    const allowed = new Map([
      ["active", "Active"],
      ["rejected", "Rejected"],
      ["inactive", "Inactive"]
    ]);
    const normalized = allowed.get(status.toLowerCase());

    if (!normalized) {
      return res.status(400).json({
        success: false,
        message: "STATUS ต้องเป็น Active, Rejected หรือ Inactive"
      });
    }

    const found = await findUserRowById(req.params.userId);
    if (!found) {
      return res.status(404).json({ success: false, message: "ไม่พบผู้ใช้งาน" });
    }

    const updated = await updateUserRow(req.params.userId, { STATUS: normalized });
    return res.json({ success: true, message: `เปลี่ยนสถานะเป็น ${normalized} สำเร็จ`, user: safeUser(updated) });
  } catch (err) {
    console.error("ADMIN STATUS ERROR:", err);
    return res.status(500).json({ success: false, message: "ไม่สามารถเปลี่ยนสถานะผู้ใช้งานได้" });
  }
});

/* =========================================
   USERS
========================================= */

app.get("/api/users", requireAuth, async (req, res) => {
  try {
    const users = await getUsers();

    res.json(
      users
        .filter(u =>
          String(u.STATUS).toLowerCase() === "active"
        )
        .map(u => ({
          user_id: u.USER_ID,
          full_name: u.FULL_NAME,
          position: u.POSITION,
          username: u.USERNAME
        }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

/* =========================================
   BRANCH ACCESS / COUNT SESSION SCHEMA
========================================= */
const COUNT_SESSION_HEADERS = [
  "SESSION_ID", "MOVEMENT_ID", "CODE", "NAME",
  "QTY", "USER", "TIME", "BRANCH_ID"
];

function parseBranchIds(value) {
  return [...new Set(String(value || "")
    .split(/[,;|\n]+/)
    .map(v => v.trim())
    .filter(Boolean))];
}

async function getCurrentUserRecord(req) {
  const users = await getUsers();
  return users.find(u => String(u.USER_ID) === String(req.user.user_id)) || null;
}

async function getAuthorizedBranch(req, requestedBranchId = "") {
  const record = await getCurrentUserRecord(req);
  if (!record || String(record.STATUS || "").toLowerCase() !== "active") {
    const err = new Error("ไม่พบผู้ใช้งานหรือบัญชีไม่ได้รับอนุมัติ");
    err.status = 403;
    throw err;
  }

  const allowed = parseBranchIds(record.BRANCH_IDS);
  if (!allowed.length) {
    const err = new Error("บัญชีนี้ยังไม่ได้กำหนด BRANCH_IDS กรุณาติดต่อผู้ดูแลระบบ");
    err.status = 403;
    throw err;
  }

  const requested = String(requestedBranchId || "").trim();
  if (requested) {
    if (!allowed.includes(requested)) {
      const err = new Error("คุณไม่มีสิทธิ์ใช้งานสาขาที่เลือก");
      err.status = 403;
      throw err;
    }
    return requested;
  }

  if (allowed.length === 1) return allowed[0];
  const err = new Error("กรุณาเลือกสาขาก่อนเริ่มตรวจนับ");
  err.status = 400;
  err.branchIds = allowed;
  throw err;
}

async function ensureCountSessionSheet() {
  await ensureSheet("COUNT_SESSION", COUNT_SESSION_HEADERS);
  const sheets = await sheetsApi();
  // Keep the agreed 8-column schema. Existing historical rows remain intact;
  // old rows have a blank BRANCH_ID and are intentionally not assigned to a guessed branch.
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: "COUNT_SESSION!A1:H1",
    valueInputOption: "RAW",
    requestBody: { values: [COUNT_SESSION_HEADERS] }
  });
}

/* =========================================
   SESSION CREATE
========================================= */

app.get("/api/session/new", requireAuth, async (req, res) => {
  try {
    const record = await getCurrentUserRecord(req);
    if (!record || String(record.STATUS || "").toLowerCase() !== "active") {
      return res.status(403).json({ success: false, message: "บัญชีผู้ใช้ยังไม่ได้รับอนุมัติ" });
    }
    const branch_ids = parseBranchIds(record.BRANCH_IDS);
    if (!branch_ids.length) {
      return res.status(403).json({ success: false, message: "บัญชีนี้ยังไม่ได้กำหนด BRANCH_IDS" });
    }
    res.json({
      success: true,
      session_id: `S${Date.now()}`,
      branch_ids,
      user: {
        user_id: req.user.user_id,
        full_name: req.user.full_name,
        full_name_th: req.user.full_name_th || "",
        full_name_en: req.user.full_name_en || "",
        position: req.user.position,
        employment_type: req.user.employment_type || "",
        role: req.user.role || "USER",
        username: req.user.username
      }
    });
  } catch (err) {
    console.error("SESSION CREATE ERROR:", err);
    res.status(500).json({ success: false, message: "สร้าง Session ไม่สำเร็จ" });
  }
});

/* =========================================
   MOVEMENT CACHE
========================================= */

let movementCache = [];
let lastMovementLoad = 0;

async function loadMovementCache() {
  const rows = await getValues("INVENTORY_MOVEMENT!A:P");

  if (!rows.length) {
    movementCache = [];
    return;
  }

  console.log("HEADER =", rows[0]);

  movementCache = rows.slice(1);
  lastMovementLoad = Date.now();

  console.log("MOVEMENT CACHE LOADED:", movementCache.length);
}

function mapRow(row = []) {
  if (!Array.isArray(row)) return {};

  const obj = {};

  for (let i = 0; i < MOVEMENT_SCHEMA.length; i++) {
    obj[MOVEMENT_SCHEMA[i]] = row[i] ?? "";
  }

  obj.qty = Number(obj.qty || 0);

  return obj;
}

app.get("/api/movement/:id", requireAuth, async (req, res) => {
  try {
    if (
      !movementCache.length ||
      Date.now() - lastMovementLoad > 5 * 60 * 1000
    ) {
      await loadMovementCache();
    }

    const id = String(req.params.id)
      .trim()
      .toUpperCase();

    const found = movementCache.find(r =>
      Array.isArray(r) &&
      String(r[0] || "").trim().toUpperCase() === id
    );

    if (!found) {
      return res.status(404).json({
        ok: false,
        error: "not found"
      });
    }

    return res.json({
      ok: true,
      data: mapRow(found)
    });
  } catch (err) {
    console.error("MOVEMENT ERROR:", err);

    return res.status(500).json({
      ok: false,
      error: err.message || "server error"
    });
  }
});

/* =========================================
   SAVE COUNT SESSION
========================================= */

app.post("/api/count", requireAuth, async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : [];
    if (!items.length) return res.status(400).json({ success: false, message: "ไม่มีรายการตรวจนับ" });

    const requestedBranches = [...new Set(items.map(i => String(i.branch_id || "").trim()).filter(Boolean))];
    if (requestedBranches.length > 1) {
      return res.status(400).json({ success: false, message: "รายการเดียวกันต้องอยู่ในสาขาเดียวกัน" });
    }
    const branchId = await getAuthorizedBranch(req, requestedBranches[0] || "");
    await ensureCountSessionSheet();
    const sheets = await sheetsApi();
    const now = new Date().toISOString();
    const rows = items.map(i => ([
      String(i.session_id || ""),
      String(i.movement_id || ""),
      String(i.code || ""),
      String(i.name || ""),
      Number(i.qty || 0),
      req.user.full_name,
      now,
      branchId
    ]));

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "COUNT_SESSION!A:H",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rows }
    });

    res.json({ success: true, branch_id: branchId, saved: rows.length });
  } catch (err) {
    console.error("SAVE COUNT SESSION ERROR:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "บันทึกข้อมูลไม่สำเร็จ", branch_ids: err.branchIds || undefined });
  }
});

/* =========================================
   GET SESSION
========================================= */

app.get("/api/session/:sid", requireAuth, async (req, res) => {
  try {
    const branchId = await getAuthorizedBranch(req, req.query.branch_id || "");
    await ensureCountSessionSheet();
    const rows = await getValues("COUNT_SESSION!A:H");
    res.json(rows.slice(1)
      .filter(r => String(r[0] || "") === req.params.sid &&
        String(r[5] || "") === String(req.user.full_name || "") &&
        String(r[7] || "") === branchId)
      .map(r => ({
        session_id: r[0], movement_id: r[1], code: r[2], name: r[3],
        qty: Number(r[4] || 0), user: r[5], time: r[6], branch_id: r[7]
      })));
  } catch (err) {
    console.error("GET SESSION ERROR:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "อ่านข้อมูล Session ไม่สำเร็จ", branch_ids: err.branchIds || undefined });
  }
});

/* =========================================
   CLOSE SESSION
========================================= */

app.post("/api/close", requireAuth, async (req, res) => {
  try {
    const session_id = String(req.body.session_id || "");
    const branchId = await getAuthorizedBranch(req, req.body.branch_id || "");
    if (!session_id) return res.status(400).json({ success: false, message: "ไม่พบ SESSION_ID" });

    const master = await getValues("INVENTORY_MASTER!A:D");
    await ensureCountSessionSheet();
    const session = await getValues("COUNT_SESSION!A:H");

    const resultHeaders = ["SESSION", "CODE", "REQUIRED", "ACTUAL", "DIFF", "BRANCH_ID"];
    await ensureSheet("SESSION_RESULT", resultHeaders);
    const sheets = await sheetsApi();
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: "SESSION_RESULT!A1:F1",
      valueInputOption: "RAW",
      requestBody: { values: [resultHeaders] }
    });

    const result = [];
    master.slice(1).forEach(r => {
      const code = String(r[0] || "");
      const required = Number(r[3] || 0);
      const actual = session.slice(1)
        .filter(x => String(x[0] || "") === session_id &&
          String(x[2] || "") === code &&
          String(x[5] || "") === String(req.user.full_name || "") &&
          String(x[7] || "") === branchId)
        .reduce((sum, x) => sum + Number(x[4] || 0), 0);
      result.push([session_id, code, required, actual, actual - required, branchId]);
    });

    if (result.length) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: "SESSION_RESULT!A:F",
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: result }
      });
    }
    res.json({ success: true, branch_id: branchId, result });
  } catch (err) {
    console.error("CLOSE SESSION ERROR:", err);
    res.status(err.status || 500).json({ success: false, message: err.message || "ปิด Session ไม่สำเร็จ", branch_ids: err.branchIds || undefined });
  }
});

/* =========================================
   DISPENSE / RX STICKER OUT
   -----------------------------------------
   Sticker business data: ONLY
   - PATIENT_NAME
   - HN
   - MEDICINE_NAME
   - DOSE_COUNT

   QR may carry JSON, query-string, or
   pipe-delimited values in this order:
   patient_name | hn | medicine_name | dose_count
========================================= */

const DISPENSE_HEADERS = [
  "DISPENSE_ID", "REF_NO", "PATIENT_NAME", "HN",
  "MEDICINE_NAME", "DOSE_COUNT", "LOT", "EXP", "CODE", "USER", "TIME", "QR_RAW"
];

function cleanText(value) {
  return String(value ?? "").trim();
}

function parseDose(value) {
  const n = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseStickerPayload(raw) {
  const text = cleanText(raw);
  if (!text) return null;

  // 1) JSON QR payload
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === "object") {
      return {
        patient_name: cleanText(obj.patient_name ?? obj.patientName ?? obj.name),
        hn: cleanText(obj.hn ?? obj.HN),
        medicine_name: cleanText(obj.medicine_name ?? obj.medicineName ?? obj.medicine ?? obj.drug),
        dose_count: parseDose(obj.dose_count ?? obj.doseCount ?? obj.dose ?? obj.qty ?? obj.quantity)
      };
    }
  } catch (_) {}

  // 2) query-string QR payload
  if (text.includes("=") && /(?:^|[?&])(?:hn|patient_name|patientName|medicine_name|medicine|dose_count|dose|qty)=/i.test(text)) {
    try {
      const query = text.includes("?") ? text.slice(text.indexOf("?") + 1) : text;
      const params = new URLSearchParams(query);
      return {
        patient_name: cleanText(params.get("patient_name") || params.get("patientName") || params.get("name")),
        hn: cleanText(params.get("hn") || params.get("HN")),
        medicine_name: cleanText(params.get("medicine_name") || params.get("medicineName") || params.get("medicine") || params.get("drug")),
        dose_count: parseDose(params.get("dose_count") || params.get("doseCount") || params.get("dose") || params.get("qty") || params.get("quantity"))
      };
    } catch (_) {}
  }

  // 3) simple pipe-delimited payload
  const parts = text.split("|").map(cleanText);
  if (parts.length >= 4) {
    return {
      patient_name: parts[0],
      hn: parts[1],
      medicine_name: parts[2],
      dose_count: parseDose(parts[3])
    };
  }

  return null;
}

function validateStickerData(data) {
  if (!data) return "รูปแบบข้อมูล Sticker ไม่รองรับ";
  if (!data.patient_name) return "ไม่พบชื่อผู้รับบริการใน Sticker";
  if (!data.hn) return "ไม่พบ HN ใน Sticker";
  if (!data.medicine_name) return "ไม่พบชื่อยา/วัคซีนใน Sticker";
  if (!data.dose_count) return "ไม่พบจำนวนโดสใน Sticker";
  return null;
}

function normalizeMedicineName(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/วัคซีน|vaccine|medicine|medication|ชื่อยา|ชื่อวัคซีน/g, "")
    .replace(/[\s\-_.(),/\\:;|]+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function normalizeMovementType(value) {
  const type = cleanText(value).toUpperCase();
  if (["OUT", "ISSUE", "DISPENSE", "เบิก", "จ่าย", "เบิกจ่าย", "ตัดสต็อก"].includes(type)) return "OUT";
  if (["IN", "RECEIVE", "RECEIVED", "รับ", "รับเข้า", "เติมสต็อก"].includes(type)) return "IN";
  return type;
}

async function getAvailableDispenseLots(medicineName) {
  const targetName = cleanText(medicineName);
  const targetNorm = normalizeMedicineName(targetName);
  if (!targetNorm) return [];

  const movementRows = await getValues("VACCINE_MOVEMENT!A:P");
  if (!Array.isArray(movementRows) || movementRows.length < 2) return [];

  const movementHeader = movementRows[0] || [];
  const movementIndex = Object.fromEntries(
    movementHeader.map((h, i) => [String(h).trim().toUpperCase(), i])
  );
  const getMovement = (row, name) => row[movementIndex[name]] ?? "";
  const rows = movementRows.slice(1).map(row => ({
    name: cleanText(getMovement(row, "NAME")),
    normalizedName: normalizeMedicineName(getMovement(row, "NAME")),
    code: cleanText(getMovement(row, "CODE")),
    lot: cleanText(getMovement(row, "LOT")),
    exp: cleanText(getMovement(row, "EXP")),
    type: normalizeMovementType(getMovement(row, "TYPE")),
    qty: Number(String(getMovement(row, "QTY")).replace(/,/g, "")) || 0
  })).filter(x => x.name && x.normalizedName && x.lot);

  // Alias สำหรับชื่อบน Sticker ที่ต่างจากชื่อใน VACCINE_MOVEMENT
  const medicineAliases = new Map([
    [normalizeMedicineName("Vaccine Speeda (FS1)"), "6SPEED0001BG"],
    [normalizeMedicineName("Speeda FS1"), "6SPEED0001BG"],
    [normalizeMedicineName("Speeda"), "6SPEED0001BG"]
  ]);
  const aliasCode = medicineAliases.get(targetNorm);
  const inventoryNames = [...new Set(rows.map(x => x.name))];
  let matchedCodes = new Set();
  let matchedNames = [];

  if (aliasCode) {
    matchedCodes.add(aliasCode);
    matchedNames = [...new Set(rows.filter(x => x.code === aliasCode).map(x => x.name))];
  } else {
    matchedNames = inventoryNames.filter(name => normalizeMedicineName(name) === targetNorm);
    if (!matchedNames.length) {
      const partial = inventoryNames.filter(name => {
        const n = normalizeMedicineName(name);
        return n.length >= 5 && targetNorm.length >= 5 && (n.includes(targetNorm) || targetNorm.includes(n));
      });
      const bestLength = partial.length ? Math.max(...partial.map(name => normalizeMedicineName(name).length)) : 0;
      const best = partial.filter(name => normalizeMedicineName(name).length === bestLength);
      const bestCodes = new Set(rows.filter(x => best.includes(x.name)).map(x => x.code));
      if (bestCodes.size === 1) matchedNames = best;
    }
    matchedCodes = new Set(rows.filter(x => matchedNames.includes(x.name)).map(x => x.code));
  }
  const matchedSet = new Set(matchedNames);
  const matchedNormalizedNames = new Set(matchedNames.map(normalizeMedicineName));
  if (!matchedSet.size) {
    console.warn("DISPENSE LOTS: no inventory name match", {
      scannedName: targetName,
      inventoryNames: inventoryNames.slice(0, 30)
    });
    return [];
  }

  const groups = new Map();
  for (const row of rows) {
    if (!matchedCodes.has(row.code)) continue;
    const key = `${row.code}||${row.lot}`;
    if (!groups.has(key)) groups.set(key, {
      code: row.code, lot: row.lot, exp: row.exp, balance: 0, name: row.name
    });
    const item = groups.get(key);
    if (row.exp) item.exp = row.exp;
    if (row.type === "OUT") item.balance -= row.qty;
    else if (row.type === "IN") item.balance += row.qty;
    else console.warn("DISPENSE LOTS: ignored unknown movement type", row.type, row.name, row.lot);
  }

  // Deduct previous dispensing records from the same medicine and LOT.
  let dispenseRows = [];
  try { dispenseRows = await getValues("INVENTORY_DISPENSE!A:L"); } catch (_) {}
  if (Array.isArray(dispenseRows) && dispenseRows.length > 1) {
    const dispenseHeader = dispenseRows[0] || [];
    const dispenseIndex = Object.fromEntries(
      dispenseHeader.map((h, i) => [String(h).trim().toUpperCase(), i])
    );
    const getDispense = (row, name) => row[dispenseIndex[name]] ?? "";
    for (const row of dispenseRows.slice(1)) {
      const name = cleanText(getDispense(row, "MEDICINE_NAME"));
      const lot = cleanText(getDispense(row, "LOT"));
      if (!lot) continue;
      const code = cleanText(getDispense(row, "CODE"));
      const nameMatches = name && matchedNormalizedNames.has(normalizeMedicineName(name));
      if (code ? !matchedCodes.has(code) : !nameMatches) continue;
      const qty = Number(String(getDispense(row, "DOSE_COUNT")).replace(/,/g, "")) || 0;
      const item = groups.get(`${code}||${lot}`) || [...groups.values()].find(x => x.lot === lot && (!code || x.code === code));
      if (item) item.balance -= qty;
    }
  }

  const available = [...groups.values()]
    .filter(x => x.balance > 0)
    .sort((a, b) => String(a.lot).localeCompare(String(b.lot), undefined, { numeric: true }));
  console.log("DISPENSE LOTS RESULT:", {
    scannedName: targetName,
    matchedNames,
    lotCount: available.length,
    lots: available.map(x => ({ code: x.code, lot: x.lot, balance: x.balance }))
  });
  return available;
}

async function nextDispenseRefNo() {
  const yearMonth = new Date().toISOString().slice(0, 7).replace("-", "");
  let rows = [];
  try {
    rows = await getValues("INVENTORY_DISPENSE!A:L");
  } catch (_) {}

  let max = 0;
  for (const row of rows.slice(1)) {
    const ref = String(row[1] || "");
    const m = ref.match(new RegExp(`^DSP-${yearMonth}-(\\d+)$`));
    if (m) max = Math.max(max, Number(m[1]));
  }

  return `DSP-${yearMonth}-${String(max + 1).padStart(5, "0")}`;
}

app.get("/api/dispense/lookup/:id", requireAuth, async (req, res) => {
  try {
    const raw = decodeURIComponent(String(req.params.id || "")).trim();
    const data = parseStickerPayload(raw);
    const validationError = validateStickerData(data);

    if (validationError) {
      return res.status(422).json({
        success: false,
        code: "INVALID_STICKER",
        message: validationError
      });
    }

    return res.json({
      success: true,
      data: {
        patient_name: data.patient_name,
        hn: data.hn,
        medicine_name: data.medicine_name,
        dose_count: data.dose_count,
        qr_raw: raw
      }
    });
  } catch (err) {
    console.error("DISPENSE LOOKUP ERROR:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "ไม่สามารถอ่าน Sticker ได้"
    });
  }
});

app.get("/api/dispense/lots", requireAuth, async (req, res) => {
  try {
    const medicineName = cleanText(req.query?.medicine_name);
    if (!medicineName) {
      return res.status(400).json({ success: false, message: "กรุณาระบุชื่อยา/วัคซีน" });
    }

    const lots = await getAvailableDispenseLots(medicineName);
    return res.json({ success: true, data: lots });
  } catch (err) {
    console.error("DISPENSE LOT LOOKUP ERROR:", err);
    return res.status(500).json({ success: false, message: err.message || "ไม่สามารถค้นหา Lot ได้" });
  }
});

app.post("/api/dispense", requireAuth, async (req, res) => {
  try {
    const data = {
      patient_name: cleanText(req.body?.patient_name),
      hn: cleanText(req.body?.hn),
      medicine_name: cleanText(req.body?.medicine_name),
      dose_count: parseDose(req.body?.dose_count),
      lot: cleanText(req.body?.lot)
    };

    const validationError = validateStickerData(data);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }
    if (!data.lot) {
      return res.status(400).json({ success: false, message: "กรุณาเลือก Lot" });
    }

    // Always resolve Lot / EXP / CODE from Inventory on the server.
    // Do not trust values sent back by the browser.
    const availableLots = await getAvailableDispenseLots(data.medicine_name);
    const selectedLot = availableLots.find(x => String(x.lot).trim() === data.lot);

    if (!selectedLot) {
      return res.status(409).json({
        success: false,
        code: "LOT_NOT_AVAILABLE",
        message: "Lot ที่เลือกไม่มี Stock แล้ว หรือไม่ตรงกับยา/วัคซีนที่เลือก"
      });
    }

    if (data.dose_count > Number(selectedLot.balance)) {
      return res.status(409).json({
        success: false,
        code: "INSUFFICIENT_STOCK",
        message: `Lot ${selectedLot.lot} คงเหลือ ${selectedLot.balance} แต่ต้องจ่าย ${data.dose_count}`
      });
    }

    if (!selectedLot.exp) {
      return res.status(409).json({
        success: false,
        code: "LOT_EXP_MISSING",
        message: "Lot ที่เลือกไม่มีข้อมูล EXP ใน Inventory"
      });
    }

    await ensureSheet("INVENTORY_DISPENSE", DISPENSE_HEADERS);

    const refNo = await nextDispenseRefNo();
    const dispenseId = `DO${Date.now()}`;
    const now = new Date().toISOString();
    const qrRaw = cleanText(req.body?.qr_raw);

    const sheets = await sheetsApi();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "INVENTORY_DISPENSE!A:L",
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          dispenseId,
          refNo,
          data.patient_name,
          data.hn,
          data.medicine_name,
          data.dose_count,
          selectedLot.lot,
          selectedLot.exp,
          selectedLot.code,
          req.user.full_name,
          now,
          qrRaw
        ]]
      }
    });

    return res.json({
      success: true,
      dispense_id: dispenseId,
      ref_no: refNo,
      data: {
        ...data,
        lot: selectedLot.lot,
        exp: selectedLot.exp,
        code: selectedLot.code,
        balance_before: selectedLot.balance,
        balance_after: selectedLot.balance - data.dose_count
      }
    });
  } catch (err) {
    console.error("DISPENSE SAVE ERROR:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "บันทึกการจ่ายยาไม่สำเร็จ"
    });
  }
});

/* =========================================
   STARTUP
========================================= */

const PORT = process.env.PORT || 3009;

if (require.main === module) {
  loadMovementCache().catch(console.error);

  setInterval(() => {
    loadMovementCache().catch(console.error);
  }, 5 * 60 * 1000);

  app.listen(PORT, () => {
    console.log(`RUN PORT ${PORT}`);
  });
}

module.exports = {
  app,
  USERS_HEADERS,
  safeUser,
  findUserRowById,
  updateUserRow
};
