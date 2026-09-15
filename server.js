require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const { google } = require("googleapis");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const SHEET_ID = "1-c2zcJPV4KNxZSuOWoYlbs3vqyVW08HUogUJWW0eN9w";

/* =========================================
   GOOGLE AUTH
========================================= */
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

/* =========================================
   SCHEMA MAPPING
========================================= */
const MOVEMENT_SCHEMA = [
  "movement_id","type","ref_no","date",
  "code","name","qty","unit",
  "lot","exp","target","user",
  "time","remark","location","qrcode"
];

function mapRow(row = []) {
  if (!Array.isArray(row)) return {};

  const obj = {};

  for (let i = 0; i < MOVEMENT_SCHEMA.length; i++) {
    obj[MOVEMENT_SCHEMA[i]] = row[i] ?? "";
  }

  obj.qty = Number(obj.qty || 0);

  return obj;
}

/* =========================================
   SHEET HELPER
========================================= */
async function ensureSheet(name, header = []) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
  });

  const exists = meta.data.sheets.some(
    s => s.properties.title === name
  );

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [
          { addSheet: { properties: { title: name } } }
        ],
      },
    });

    if (header.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${name}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [header] },
      });
    }
  }
}

/* =========================================
   MOVEMENT CACHE
========================================= */
let movementCache = [];
let lastMovementLoad = 0;

async function loadMovementCache() {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "INVENTORY_MOVEMENT!A:P",
  });

  const rows = result.data.values || [];

  if (!rows.length) {
    movementCache = [];
    return;
  }

  console.log("HEADER =", rows[0]);

  movementCache = rows.slice(1);
  lastMovementLoad = Date.now();

  console.log("MOVEMENT CACHE LOADED:", movementCache.length);
}

/* =========================================
   USERS
========================================= */
app.get("/api/users", async (req, res) => {
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "USERS!A:A",
    });

    const rows = result.data.values || [];

    res.json(
      rows.flat().filter(u => u && u !== "USER")
    );

  } catch (err) {
    console.error(err);
    res.status(500).json([]);
  }
});

/* =========================================
   SESSION CREATE
========================================= */
app.get("/api/session/new", (req, res) => {
  res.json({
    session_id: `S${Date.now()}`
  });
});

/* =========================================
   MOVEMENT SEARCH (SCAN API)
========================================= */
app.get("/api/movement/:id", async (req, res) => {
  try {

    if (!movementCache.length ||
        Date.now() - lastMovementLoad > 5 * 60 * 1000) {
      await loadMovementCache();
    }

    const id = String(req.params.id).trim().toUpperCase();

    const found = movementCache.find(r => {
      if (!Array.isArray(r)) return false;
      return String(r[0] || "").trim().toUpperCase() === id;
    });

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
app.post("/api/count", async (req, res) => {
  try {

    await ensureSheet("COUNT_SESSION", [
      "SESSION_ID","MOVEMENT_ID","CODE","NAME","QTY","USER","TIME"
    ]);

    const items = req.body || [];

    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    const rows = items.map(i => ([
      i.session_id,
      i.movement_id,
      i.code,
      i.name,
      i.qty,
      i.user,
      new Date().toISOString(),
    ]));

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "COUNT_SESSION!A:G",
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });

    res.json({ success: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "save failed" });
  }
});

/* =========================================
   GET SESSION
========================================= */
app.get("/api/session/:sid", async (req, res) => {
  try {

    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "COUNT_SESSION!A:G",
    });

    const rows = result.data.values || [];

    res.json(
      rows
        .filter(r => r[0] === req.params.sid)
        .map(r => ({
          session_id: r[0],
          movement_id: r[1],
          code: r[2],
          name: r[3],
          qty: Number(r[4]),
          user: r[5],
          time: r[6],
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
app.post("/api/close", async (req, res) => {
  try {

    const session_id = req.body.session_id;

    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    const master = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "INVENTORY_MASTER!A:D",
    });

    const session = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "COUNT_SESSION!A:G",
    });

    const m = master.data.values || [];
    const s = session.data.values || [];

    await ensureSheet("SESSION_RESULT", [
      "SESSION","CODE","REQUIRED","ACTUAL","DIFF"
    ]);

    const result = [];

    m.forEach(r => {

      const code = r[0];
      const required = Number(r[3]);

      const actual = s
        .filter(x => x[0] === session_id && x[2] === code)
        .reduce((sum, x) => sum + Number(x[4]), 0);

      result.push([
        session_id,
        code,
        required,
        actual,
        actual - required,
      ]);
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "SESSION_RESULT!A:E",
      valueInputOption: "RAW",
      requestBody: { values: result },
    });

    res.json({ success: true, result });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "close failed" });
  }
});

/* =========================================
   CACHE INIT
========================================= */
loadMovementCache().catch(console.error);

setInterval(() => {
  loadMovementCache().catch(console.error);
}, 5 * 60 * 1000);

/* =========================================
   START SERVER
========================================= */
const PORT = process.env.PORT || 3009;

app.listen(PORT, () => {
  console.log(`RUN PORT ${PORT}`);
});