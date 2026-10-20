/* =========================================
   SESSION VIEW
========================================= */

import {
  saveMovements,
  closeMovementSession
} from "../modules/movement.js";

import { startScanner } from "../modules/scanner.js";

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

const params = new URLSearchParams(location.search);

let session_id = "";
let user = "";
let branch_id = "";

let currentItem = null;
let items = [];

/* =========================================
   INIT
========================================= */

window.addEventListener("DOMContentLoaded", async () => {

  await createSession();

  renderInfo();
  renderPreview();
  renderList();

  startScanner(item => {

    currentItem = {
      session_id,
      user,
      branch_id,
      ...item
    };

    renderPreview();
  });

  document
    .getElementById("btnSendAll")
    ?.addEventListener("click", closeSession);

  document
    .getElementById("btnClear")
    ?.addEventListener("click", resetSession);

});

/* =========================================
   SESSION
========================================= */

async function createSession() {

  try {

    const r = await fetch("/api/session/new");

    if (!r.ok)
      throw new Error("Create Session Failed");

    const d = await r.json();

    if (!d.success) throw new Error(d.message || "Create Session Failed");

    session_id = d.session_id;
    user = d.user?.full_name || "-";

    const branchIds = Array.isArray(d.branch_ids) ? d.branch_ids : [];
    if (branchIds.length === 1) {
      branch_id = branchIds[0];
    } else if (branchIds.length > 1) {
      const options = Object.fromEntries(branchIds.map(id => [id, id]));
      const selected = await Swal.fire({
        title: "เลือกสาขาที่ตรวจนับ",
        input: "select",
        inputOptions: options,
        inputPlaceholder: "เลือกสาขา",
        showCancelButton: true,
        confirmButtonText: "ยืนยัน",
        cancelButtonText: "ยกเลิก",
        allowOutsideClick: false,
        inputValidator: value => value ? undefined : "กรุณาเลือกสาขา"
      });
      if (!selected.isConfirmed || !selected.value) {
        throw new Error("กรุณาเลือกสาขาก่อนเริ่มตรวจนับ");
      }
      branch_id = selected.value;
    } else {
      throw new Error(d.message || "บัญชีนี้ยังไม่ได้กำหนดสาขา");
    }

  } catch (err) {

    console.error(err);

    Swal.fire({
      icon: "error",
      title: "Session Error",
      text: err.message
    });
  }
}

function renderInfo() {

  document.getElementById("sessionId").textContent =
    session_id || "-";

  document.getElementById("userName").textContent =
    user;

  document.getElementById("totalItems").textContent =
    items.length;
}

/* =========================================
   PREVIEW
========================================= */

function renderPreview() {

  const el = document.getElementById("preview");

  if (!currentItem) {

    el.innerHTML = `
      <div class="empty">
        สแกน QR เพื่อเริ่มต้น
      </div>
    `;

    return;
  }

  el.innerHTML = `
    <div class="card">

      <h3>${currentItem.code}</h3>

      <p>${currentItem.name}</p>

      <p>LOT : ${currentItem.lot}</p>

      <p>EXP : ${formatDateMDY(currentItem.exp)}</p>

      <div class="qty-box">

        <button
          class="qty-btn"
          onclick="changePreviewQty(-1)">
          −
        </button>

        <input
          id="previewQty"
          type="number"
          min="1"
          value="${currentItem.qty}"
        >

        <button
          class="qty-btn"
          onclick="changePreviewQty(1)">
          +
        </button>

      </div>

      <button
        class="btn-success"
        onclick="confirmItem()">

        Confirm

      </button>

    </div>
  `;
}

window.changePreviewQty = step => {

  const input =
    document.getElementById("previewQty");

  if (!input) return;

  let qty = Number(input.value) + step;

  if (qty < 1) qty = 1;

  input.value = qty;
};

/* =========================================
   CONFIRM ITEM
========================================= */

window.confirmItem = () => {

  if (!currentItem) return;

  currentItem.qty = Number(
    document.getElementById("previewQty")?.value || 1
  );

  const found = items.find(
    i => i.movement_id === currentItem.movement_id
  );

  if (found)
    found.qty += currentItem.qty;

  else
    items.push({ ...currentItem });

  currentItem = null;

  renderPreview();
  renderList();
  renderInfo();

  Swal.fire({
    toast: true,
    position: "top",
    timer: 1000,
    showConfirmButton: false,
    icon: "success",
    title: "เพิ่มรายการแล้ว"
  });
};

/* =========================================
   LIST
========================================= */

function renderList() {

  const el = document.getElementById("list");

  if (!items.length) {

    el.innerHTML = `
      <div class="empty">
        ยังไม่มีรายการ
      </div>
    `;

    return;
  }

  el.innerHTML = items.map((item, index) => `
    <div class="item">

      <div class="item-left">

        <div class="code">
          ${item.code}
        </div>

        <div class="name">
          ${item.name}
        </div>

        <small>
          ${item.lot} | ${formatDateMDY(item.exp)}
        </small>

      </div>

      <div class="qty-box">

        <button
          class="qty-btn"
          onclick="minus(${index})">
          −
        </button>

        <div class="qty">
          ${item.qty}
        </div>

        <button
          class="qty-btn"
          onclick="plus(${index})">
          +
        </button>

      </div>

    </div>
  `).join("");
}

/* =========================================
   LIST QTY
========================================= */

window.plus = index => {

  items[index].qty++;

  renderList();
};

window.minus = index => {

  if (items[index].qty > 1)
    items[index].qty--;

  renderList();
};

/* =========================================
   SEND ALL
========================================= */

async function closeSession() {

  if (!items.length) {

    Swal.fire({
      icon: "warning",
      title: "ไม่มีรายการ"
    });

    return;
  }

  try {

    Swal.fire({
      title: "กำลังบันทึก...",
      allowOutsideClick: false,
      didOpen: () => Swal.showLoading()
    });

    const branchItems = items.map(item => ({ ...item, branch_id }));
    await saveMovements(branchItems);
    await closeMovementSession(session_id, branch_id);

    resetSession();

    Swal.fire({
      icon: "success",
      title: "บันทึกสำเร็จ"
    });

  } catch (err) {

    console.error(err);

    Swal.fire({
      icon: "error",
      title: "Save Failed",
      text: err.message
    });
  }
}

/* =========================================
   RESET
========================================= */

function resetSession() {

  items = [];
  currentItem = null;

  renderPreview();
  renderList();
  renderInfo();
}