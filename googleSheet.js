const { GoogleSpreadsheet } = require("google-spreadsheet");
const creds = require("./service-account.json");

const SHEET_ID = "1-c2zcJPV4KNxZSuOWoYlbs3vqyVW08HUogUJWW0eN9w";

async function getDoc() {
  const doc = new GoogleSpreadsheet(SHEET_ID);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
  return doc;
}

/* 🔍 หา movement */
async function getMovement(qr) {
  const doc = await getDoc();
  const sheet = doc.sheetsByTitle["INVENTORY_MOVEMENT"];

  const rows = await sheet.getRows();
  const item = rows.find(r =>
  (r.MOVEMENT_ID || r.movement_id) === id
);
  if (!item) return null;

  return {
    ref_no: item.REF_NO,
    code: item.CODE,
    name: item.NAME,
    qty: Number(item.QTY),
    unit: item.UNIT,
    lot: item.LOT,
    exp: item.EXP
  };
}

/* ➕ add session */
async function addCount(data) {
  const doc = await getDoc();
  const sheet = doc.sheetsByTitle["COUNT_SESSION"];

  await sheet.addRow({
    SESSION_ID: data.session_id,
    REF_NO: data.ref_no,
    DATE: new Date().toISOString(),
    CODE: data.code,
    NAME: data.name,
    QTY: data.qty,      // 🔥 ใช้ค่าจาก user
    USER: data.user,
    STATUS: "OPEN"
  });

  return { status: "success" };
}

/* 📄 get session */
async function getSession(session_id) {
  const doc = await getDoc();
  const sheet = doc.sheetsByTitle["COUNT_SESSION"];

  const rows = await sheet.getRows();

  return rows
  .filter(r => r.SESSION_ID === session_id)
  .reduce((acc, r) => {

    const found = acc.find(x => x.code === r.CODE);

    if (found) {
      found.qty += Number(r.QTY);
    } else {
      acc.push({
        ref_no: r.REF_NO,
        code: r.CODE,
        name: r.NAME,
        qty: Number(r.QTY)
      });
    }

    return acc;
  }, []);
}

module.exports = {
  getMovement,
  addCount,
  getSession
};