export async function getDispenseItem(qrValue) {
  const res = await fetch(`/api/dispense/lookup/${encodeURIComponent(qrValue)}`, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || "ไม่สามารถอ่านข้อมูล Sticker ได้");
  return data.data;
}

export async function getDispenseLots(medicineName) {
  const res = await fetch(`/api/dispense/lots?medicine_name=${encodeURIComponent(medicineName)}`, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || "ไม่สามารถค้นหา Lot ได้");
  return data.data || [];
}

export async function submitDispense(payload) {
  const res = await fetch("/api/dispense", {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.message || "บันทึกการจ่ายยาไม่สำเร็จ");
  return data;
}
