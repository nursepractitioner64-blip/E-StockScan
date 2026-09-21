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
  "CREATED_AT"
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
    const parts = String(stored || "").split(":");

    if (parts.length !== 3 || parts[0] !== "scrypt") {
      return resolve(false);
    }

    const salt = parts[1];
    const expected = Buffer.from(parts[2], "hex");

    crypto.scrypt(password, salt, expected.length, (err, derived) => {
      if (err || derived.length !== expected.length) {
        return resolve(false);
      }

      resolve(
        crypto.timingSafeEqual(derived, expected)
      );
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

  const rows = await getValues("USERS!A:O");

  if (!rows.length) return [];

  return rows.slice(1).map(rowToUser);
}

async function appendUser(user) {
  const sheets = await sheetsApi();

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "USERS!A:O",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [USERS_HEADERS.map(header => user[header] ?? "")]
    }
  });
}

async function findUserRowById(userId) {
  const rows = await getValues("USERS!A:O");
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

app.post("/api/auth/line/verify", async (req, res) => {
  try {
    const idToken = String(req.body.id_token || "");

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: "ไม่พบ LINE ID Token"
      });
    }

    const channelId = String(process.env.LINE_CHANNEL_ID || "");

    if (!channelId) {
      return res.status(500).json({
        success: false,
        message: "ยังไม่ได้ตั้งค่า LINE_CHANNEL_ID"
      });
    }

    const response = await fetch(
      "https://api.line.me/oauth2/v2.1/verify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          id_token: idToken,
          client_id: channelId
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(401).json({
        success: false,
        message: "LINE Token ไม่ถูกต้อง"
      });
    }

    return res.json({
      success: true,
      line: {
        user_id: data.sub || "",
        display_name: data.name || "",
        picture_url: data.picture || ""
      }
    });
  } catch (err) {
    console.error("LINE VERIFY ERROR:", err);

    res.status(500).json({
      success: false,
      message: "ตรวจสอบ LINE ไม่สำเร็จ"
    });
  }
});

/* =========================================
   REGISTER
========================================= */

app.post("/api/auth/register", async (req, res) => {
  try {
    const body = req.body || {};

    const fullNameTh = String(body.full_name_th || body.fullNameTh || body.full_name || "").trim();
    const fullNameEn = String(body.full_name_en || body.fullNameEn || "").trim();
    const positionValue = String(body.position || "").trim();
    const employmentType = String(body.employment_type || body.employmentType || "").trim();
    const safeUsername = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const confirmPassword = String(body.confirm_password || body.confirmPassword || "");
    const safePhone = String(body.phone || "").trim();
    const safeEmail = String(body.email || "").trim();
    const lineUserId = String(body.line_user_id || "").trim();
    const lineDisplayName = String(body.line_display_name || "").trim();
    const linePictureUrl = String(body.line_picture_url || "").trim();

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
      CREATED_AT: new Date().toISOString()
    };

    await appendUser(user);

    return res.status(201).json({
      success: true,
      message: "ลงทะเบียนสำเร็จ กรุณารอผู้ดูแลอนุมัติ",
      user: safeUser(user)
    });
  } catch (err) {
    console.error("REGISTER ERROR:", err);

    res.status(500).json({
      success: false,
      message: err.message || "Registration failed"
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
   SESSION CREATE
========================================= */

app.get("/api/session/new", requireAuth, (req, res) => {
  res.json({
    success: true,
    session_id: `S${Date.now()}`,
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
    await ensureSheet("COUNT_SESSION", [
      "SESSION_ID", "MOVEMENT_ID", "CODE", "NAME",
      "QTY", "USER", "TIME"
    ]);

    const items = Array.isArray(req.body) ? req.body : [];
    const sheets = await sheetsApi();

    const rows = items.map(i => ([
      i.session_id,
      i.movement_id,
      i.code,
      i.name,
      i.qty,
      req.user.full_name,
      new Date().toISOString()
    ]));

    if (rows.length) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: "COUNT_SESSION!A:G",
        valueInputOption: "RAW",
        requestBody: { values: rows }
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "save failed" });
  }
});

/* =========================================
   GET SESSION
========================================= */

app.get("/api/session/:sid", requireAuth, async (req, res) => {
  try {
    const rows = await getValues("COUNT_SESSION!A:G");

    res.json(
      rows
        .filter(r =>
          r[0] === req.params.sid &&
          r[5] === req.user.full_name
        )
        .map(r => ({
          session_id: r[0],
          movement_id: r[1],
          code: r[2],
          name: r[3],
          qty: Number(r[4]),
          user: r[5],
          time: r[6]
        }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

/* =========================================
   CLOSE SESSION
========================================= */

app.post("/api/close", requireAuth, async (req, res) => {
  try {
    const session_id = req.body.session_id;

    const master = await getValues("INVENTORY_MASTER!A:D");
    const session = await getValues("COUNT_SESSION!A:G");

    await ensureSheet("SESSION_RESULT", [
      "SESSION", "CODE", "REQUIRED", "ACTUAL", "DIFF"
    ]);

    const result = [];

    master.slice(1).forEach(r => {
      const code = r[0];
      const required = Number(r[3]);

      const actual = session
        .filter(x =>
          x[0] === session_id &&
          x[2] === code &&
          x[5] === req.user.full_name
        )
        .reduce((sum, x) => sum + Number(x[4]), 0);

      result.push([
        session_id,
        code,
        required,
        actual,
        actual - required
      ]);
    });

    if (result.length) {
      const sheets = await sheetsApi();

      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: "SESSION_RESULT!A:E",
        valueInputOption: "RAW",
        requestBody: { values: result }
      });
    }

    res.json({ success: true, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "close failed" });
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
