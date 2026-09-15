/* =========================================
   QR SCANNER MODULE
========================================= */

import { getMovement } from "./movement.js";

let scanner = null;
let started = false;
let lock = false;
let lastCode = "";

const beep = new Audio(
  "https://actions.google.com/sounds/v1/alarms/beep_short.ogg"
);

/* =========================================
   START SCANNER
========================================= */

export async function startScanner(onPreview) {

  if (started) return;

  started = true;
  scanner = new Html5Qrcode("reader");

  try {

    await scanner.start(
      { facingMode: "environment" },

      {
        fps: 10,

        qrbox: (width, height) => ({
          width: Math.min(width, 320),
          height: Math.min(height, 320)
        })
      },

      async text => {

        if (lock || text === lastCode) return;

        lock = true;
        lastCode = text;

        setTimeout(() => {
          lock = false;
          lastCode = "";
        }, 1000);

        try {

          const data = await getMovement(text);

          beep.play().catch(() => {});

          if (typeof onPreview === "function") {

            onPreview({
              movement_id: data.movement_id,
              code: data.code,
              name: data.name,
              lot: data.lot || "-",
              exp: data.exp || "-",
              qty: 1
            });

          }

        } catch (err) {

          console.error("SCAN ERROR:", err);

          Swal.fire({
            icon: "warning",
            title: err.message || "ไม่พบข้อมูล"
          });
        }
      },

      error => {
        // ไม่ต้องแสดง Error ทุก Frame
        console.debug("SCAN:", error);
      }
    );

  } catch (err) {

    started = false;

    console.error("CAMERA ERROR:", err);

    Swal.fire({
      icon: "error",
      title: "เปิดกล้องไม่ได้",
      text: err.message || "Camera Error"
    });
  }
}

/* =========================================
   STOP SCANNER
========================================= */

export async function stopScanner() {

  if (!scanner) return;

  try {

    await scanner.stop();
    await scanner.clear();

  } catch (err) {

    console.error("STOP SCANNER:", err);

  } finally {

    scanner = null;
    started = false;
    lock = false;
    lastCode = "";

  }
}