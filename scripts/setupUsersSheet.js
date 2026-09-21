require("dotenv").config();

const { google } = require("googleapis");

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = "USERS";

const HEADERS = [
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

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: String(process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

function normalizeHeader(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toUpperCase();
}

function normalizeRow(row, currentHeaders) {
  const source = {};
  currentHeaders.forEach((header, index) => {
    source[normalizeHeader(header)] = row[index] ?? "";
  });

  return HEADERS.map(header => {
    const key = normalizeHeader(header);

    if (key === "ROLE") {
      return String(source.ROLE || "USER").trim().toUpperCase() === "ADMIN"
        ? "ADMIN"
        : "USER";
    }

    if (key === "FULL_NAME_TH") {
      return source.FULL_NAME_TH || source.FULL_NAME || "";
    }

    if (key === "FULL_NAME_EN") {
      return source.FULL_NAME_EN || "";
    }

    if (key === "EMPLOYMENT_TYPE") {
      return source.EMPLOYMENT_TYPE || "";
    }

    return source[key] ?? "";
  });
}

(async () => {
  try {
    if (!SHEET_ID) throw new Error("GOOGLE_SHEET_ID is required");

    console.log("\n============================================");
    console.log(" USERS SHEET SETUP");
    console.log("============================================");

    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    let userSheet = meta.data.sheets.find(
      s => s.properties?.title === SHEET_NAME
    );

    if (!userSheet) {
      console.log("Creating USERS sheet...");
      const result = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [{ addSheet: { properties: { title: SHEET_NAME } } }]
        }
      });
      userSheet = result.data.replies?.[0]?.addSheet;
      console.log("✓ USERS sheet created");
    } else {
      console.log("✓ USERS sheet already exists");
    }

    const current = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:O`
    });

    const rows = current.data.values || [];
    const rawHeader = rows[0] || [];
    const currentHeaders = rawHeader.map(normalizeHeader).filter(Boolean);
    const expectedHeaders = HEADERS.map(normalizeHeader);

    console.log("\nCurrent Header:");
    console.log(rawHeader);
    console.log("\nExpected Header:");
    console.log(HEADERS);

    if (!currentHeaders.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [HEADERS] }
      });
      console.log("\n✓ Empty USERS sheet initialized");
    } else if (currentHeaders.join("|") === expectedHeaders.join("|")) {
      console.log("\n✓ USERS header is correct");
    } else {
      const normalizedRows = rows.slice(1).map(row => normalizeRow(row, currentHeaders));

      await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A:O`
      });

      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A1`,
        valueInputOption: "RAW",
        requestBody: {
          values: [HEADERS, ...normalizedRows]
        }
      });

      console.log("\n✓ USERS schema migrated");
      console.log(`✓ Preserved ${normalizedRows.length} existing user row(s)`);
      console.log("✓ Missing ROLE values defaulted to USER");
    }

    const verify = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1:O2`
    });

    console.log("\n============================================");
    console.log(" USERS SHEET READY");
    console.log("============================================");
    console.log(JSON.stringify(verify.data.values || [], null, 2));
    console.log("\n✓ Existing user data preserved");
    console.log("✓ Ready for User Management / Approval");
  } catch (error) {
    console.error("\n============================================");
    console.error(" USERS SETUP FAILED");
    console.error("============================================");
    console.error(error.message);
    process.exit(1);
  }
})();
