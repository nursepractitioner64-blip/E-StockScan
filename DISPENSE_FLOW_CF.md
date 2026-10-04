# DISPENSE Flow — CF

```text
DISPENSE
   ↓
SCAN STICKER
   ↓
อ่านข้อมูลจาก Sticker
   ↓
Fill Form
   ├── ชื่อผู้รับบริการ
   ├── HN
   ├── ชื่อยา/วัคซีน
   └── จำนวนโดส
   ↓
เอา "ชื่อยา/วัคซีน"
ไปค้น INVENTORY_MOVEMENT
   ↓
ดึง Lot ที่มีอยู่ของยานั้น
   ↓
แสดงให้ผู้ตรวจเลือก
   ↓
เลือก Lot
   ↓
ระบบนำ EXP ของ Lot นั้นมา Fill อัตโนมัติ
   ↓
ผู้ตรวจสอบข้อมูล
   ↓
ยืนยันการจ่าย
   ↓
INVENTORY_DISPENSE
```

Rules:
- Sticker supplies only patient name, HN, medicine/vaccine name, and dose count.
- Lot and EXP are not trusted from Sticker.
- Lot options come from INVENTORY_MOVEMENT using medicine/vaccine name.
- EXP is resolved from the selected Inventory Lot.
- Server re-validates selected Lot and available balance before saving.
- Saved INVENTORY_DISPENSE transactions reduce the balance shown for subsequent Lot selection.
