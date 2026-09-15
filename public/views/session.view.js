/* =========================================
   SESSION VIEW
========================================= */

import {
  saveMovements,
  closeMovementSession
} from "../modules/movement.js";

import { startScanner } from "../modules/scanner.js";

const params = new URLSearchParams(location.search);

let session_id = "";
const user = params.get("user") || "Nurse-A";

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

    session_id = d.session_id;

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

      <p>EXP : ${currentItem.exp}</p>

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
          ${item.lot} | ${item.exp}
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

    await saveMovements(items);
    await closeMovementSession(session_id);

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