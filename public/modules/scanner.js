import { getMovement } from "../core/api.js";
import { state } from "../core/state.js";

let lastCode = "";
let lock = false;
let started = false;
let scanner = null;

const beep = new Audio(
  "https://actions.google.com/sounds/v1/alarms/beep_short.ogg"
);

export async function startScanner(onPreview) {

  if (started) return;
  started = true;

  scanner = new Html5Qrcode("reader");

  try {

    await scanner.start(
      { facingMode: "environment" },

      {
        fps: 10,
        qrbox: (w, h) => ({
          width: Math.min(w, 320),
          height: Math.min(h, 320)
        })
      },

      async (text) => {

        if (lock || text === lastCode) return;

        lock = true;
        lastCode = text;

        setTimeout(() => {
          lock = false;
          lastCode = "";
        }, 1000);

        try {

          const res = await getMovement(text);

          if (!res?.ok || !res?.data) {
            Swal.fire({
              icon: "warning",
              title: res?.error || "ไม่พบข้อมูล"
            });
            return;
          }

          const d = res.data;

          beep.play().catch(() => {});

          onPreview({
            movement_id: d.movement_id,
            code: d.code,
            name: d.name,
            lot: d.lot || "-",
            exp: d.exp || "-",
            qty: 1
          });

        } catch (err) {

          console.error(err);

          Swal.fire({
            icon: "error",
            title: "Scan Failed",
            text: err.message || "Unknown error"
          });
        }
      }
    );

  } catch (err) {

    started = false;

    Swal.fire({
      icon: "error",
      title: "เปิดกล้องไม่ได้",
      text: err.message || "Camera error"
    });
  }
}

export async function stopScanner() {

  if (!scanner) return;

  try {
    await scanner.stop();
    await scanner.clear();
  } catch (err) {
    console.error(err);
  } finally {
    scanner = null;
    started = false;
  }
}