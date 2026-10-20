const params = new URLSearchParams(window.location.search);

let session_id = "";
let user = params.get("user") || "Nurse-A";

let items = [];
let last = "";
let scanning = false;

const beep = new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg");

/* =========================
   INIT
========================= */
window.addEventListener("DOMContentLoaded", async () => {

  await createSession();

  const info = document.getElementById("info");

  if (info) {
    info.innerHTML = `Session: ${session_id}<br>User: ${user}`;
  }

  startScanner();
});


/* =========================
   CREATE SESSION
========================= */
async function createSession() {
  try {

    const r = await fetch("/api/session/new");

    if (!r.ok) throw new Error("Create Session Failed");

    const d = await r.json();

    session_id = d.session_id;

    console.log("SESSION =", session_id);

  } catch (err) {

    console.error(err);

    Swal.fire({
      icon: "error",
      title: "Session Error",
      text: err.message
    });

  }
}


/* =========================
   START SCANNER
========================= */
function startScanner() {

  const qr = new Html5Qrcode("reader");

  qr.start(
    { facingMode: "environment" },
    {
      fps: 10,
      qrbox: (viewWidth, viewHeight) => ({
        width: viewWidth,
        height: viewHeight
      })
    },
    scan
  ).catch(err => {
    console.error(err);
    alert("Camera error: " + err);
  });
}


/* =========================
   SCAN
========================= */
async function scan(text) {

  if (scanning) return;

  if (text === last) return;

  scanning = true;

  try {

    last = text;

    beep.play().catch(() => {});

    const r = await fetch(
      `/api/movement/${encodeURIComponent(text)}`
    );

    if (!r.ok) {
      throw new Error("NOT FOUND");
    }

    const d = await r.json();

    const found = items.find(
      i => i.movement_id === d.movement_id
    );

    if (found) {

      found.qty++;

    } else {

      items.push({
        session_id,
        movement_id: d.movement_id || "-",
        code: d.code || "-",
        name: d.name || "-",
        qty: 1,
        user,
        lot: d.lot || "-",
        exp: formatDateMDY(d.exp) || "-"
      });

    }

    renderList();

    setTimeout(() => {
      last = "";
    }, 1000);

  } catch (err) {

    console.error(err);

  } finally {

    scanning = false;

  }
}


function formatDateMDY(value) {
  if (value === null || value === undefined || value === "") return "";
  const text = String(value).trim();
  let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  let year, month, day;
  if (m) { year=+m[1]; month=+m[2]; day=+m[3]; }
  else {
    m = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!m) return text;
    const a=+m[1], b=+m[2]; year=+m[3];
    if (a>12 && b<=12) { day=a; month=b; }
    else if (b>12 && a<=12) { month=a; day=b; }
    else { month=a; day=b; }
  }
  const d = new Date(Date.UTC(year,month-1,day));
  if (month<1 || month>12 || day<1 || day>31 || d.getUTCFullYear()!==year || d.getUTCMonth()!==month-1 || d.getUTCDate()!==day) return text;
  return `${String(month).padStart(2,"0")}/${String(day).padStart(2,"0")}/${year}`;
}

/* =========================
   RENDER LIST
========================= */
function renderList() {

  const el = document.getElementById("list");

  if (!el) return;

  if (!items.length) {
    el.innerHTML = `
      <div style="text-align:center;color:#94a3b8;padding:20px">
        ยังไม่มีรายการ
      </div>`;
    return;
  }

  el.innerHTML = items.map((i, index) => `
    <div class="item">

      <div>
        <div style="color:#22c55e;font-weight:600">${i.code}</div>
        <div style="font-size:12px;color:#cbd5e1">${i.name}</div>
        <div style="font-size:12px;color:#64748b">${i.lot} | ${formatDateMDY(i.exp)}</div>
      </div>

      <div style="display:flex;align-items:center;gap:8px">

        <button onclick="minus(${index})"
          style="width:30px;height:30px;border-radius:8px;border:none;background:#334155;color:white">-</button>

        <div style="min-width:25px;text-align:center;font-weight:600">
          ${i.qty}
        </div>

        <button onclick="plus(${index})"
          style="width:30px;height:30px;border-radius:8px;background:#22c55e;border:none">+</button>

      </div>

    </div>
  `).join("");
}


/* =========================
   QTY CONTROL
========================= */
function plus(i) {
  items[i].qty++;
  renderList();
}

function minus(i) {
  if (items[i].qty > 0) {
    items[i].qty--;
    renderList();
  }
}


/* =========================
   CLOSE SESSION
========================= */
async function closeSession() {

  try {

    Swal.fire({
      title: 'กำลังบันทึก...',
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    await fetch("/api/count", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(items)
    });

    await fetch("/api/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id })
    });

    items = [];
last = "";

await createSession();

const info = document.getElementById("info");

if (info) {
  info.innerHTML =
    `Session: ${session_id}<br>User: ${user}`;
}

renderList();

    Swal.fire({
      icon: 'success',
      title: 'Saved',
      text: 'Session reset complete',
      timer: 1200,
      showConfirmButton: false
    });

  } catch (err) {

    console.error(err);

    Swal.fire({
      icon: 'error',
      title: 'Save Failed',
      text: err.message
    });
  }
}