/* =========================================
   MOVEMENT API
========================================= */

/**
 * ค้นหาข้อมูลจาก QR Code
 * @param {string} code
 * @returns {Promise<Object>}
 */
export async function getMovement(code) {
  const res = await fetch(`/api/movement/${encodeURIComponent(code)}`);

  const data = await res.json();

  if (!res.ok || !data.ok) {
    throw new Error(data.error || "ไม่พบข้อมูล");
  }

  return data.data;
}

/**
 * บันทึกรายการทั้งหมด
 * @param {Array} items
 */
export async function saveMovement(item) {

  if (!item || !item.session_id || !item.movement_id || !item.code || Number(item.qty) <= 0) {
    throw new Error("ข้อมูลรายการตรวจไม่ครบ");
  }

  try {
    const res = await fetch("/api/count", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(item)
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.success) {
      throw new Error(data.error || "บันทึกข้อมูลไม่สำเร็จ");
    }

    return data;
  } catch (err) {
    console.error("SAVE MOVEMENT:", err);
    throw new Error(err.message || "บันทึกข้อมูลไม่สำเร็จ");
  }
}

/**
 * ปิด Session
 * @param {string} sessionId
 */
export async function closeMovementSession(sessionId) {

  try {

    const res = await fetch("/api/close", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        session_id: sessionId
      })
    });

    if (!res.ok) {
      throw new Error("ปิด Session ไม่สำเร็จ");
    }

    return await res.json();

  } catch (err) {

    console.error("CLOSE SESSION:", err);

    throw new Error(
      err.message || "ปิด Session ไม่สำเร็จ"
    );
  }
}