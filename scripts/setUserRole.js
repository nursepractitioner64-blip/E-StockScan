require("dotenv").config();
const { google } = require("googleapis");

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const username = String(process.argv[2] || "").trim();
const role = String(process.argv[3] || "ADMIN").trim().toUpperCase();
const status = String(process.argv[4] || "Active").trim();

if (!username) {
  console.error("Usage: node scripts/setUserRole.js <username> [ADMIN|USER] [Active|Pending|Rejected|Inactive]");
  process.exit(1);
}
if (!/^(ADMIN|USER)$/.test(role)) {
  console.error("Role must be ADMIN or USER");
  process.exit(1);
}
if (!/^(Active|Pending|Rejected|Inactive)$/.test(status)) {
  console.error("Status must be Active, Pending, Rejected or Inactive");
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: String(process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

(async () => {
  try {
    if (!SHEET_ID) throw new Error("GOOGLE_SHEET_ID is required");
    const client = await auth.getClient();
    const sheets = google.sheets({ version:"v4", auth:client });
    const result = await sheets.spreadsheets.values.get({ spreadsheetId:SHEET_ID, range:"USERS!A:O" });
    const rows = result.data.values || [];
    const header = rows[0] || [];
    const usernameIndex = header.indexOf("USERNAME");
    const roleIndex = header.indexOf("ROLE");
    const statusIndex = header.indexOf("STATUS");
    if (usernameIndex < 0 || roleIndex < 0 || statusIndex < 0) throw new Error("USERS sheet must contain USERNAME, STATUS and ROLE columns. Run setupUsersSheet.js first.");

    const rowIndex = rows.findIndex((row, index) => index > 0 && String(row[usernameIndex] || "").toLowerCase() === username.toLowerCase());
    if (rowIndex < 1) throw new Error(`User not found: ${username}`);

    const columnLetter = n => { let out=""; while(n>0){const r=(n-1)%26; out=String.fromCharCode(65+r)+out; n=Math.floor((n-1)/26);} return out; };
    const rowNumber = rowIndex + 1;
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId:SHEET_ID,
      requestBody:{
        valueInputOption:"RAW",
        data:[
          {range:`USERS!${columnLetter(roleIndex+1)}${rowNumber}`, values:[[role]]},
          {range:`USERS!${columnLetter(statusIndex+1)}${rowNumber}`, values:[[status]]}
        ]
      }
    });

    console.log(`✓ ${username} ROLE = ${role}`);
    console.log(`✓ ${username} STATUS = ${status}`);
    console.log("Restart/login again if the user already has an old session cookie.");
  } catch (err) {
    console.error("SET USER ROLE FAILED:", err.message);
    process.exit(1);
  }
})();
