# ผูก LINE กับบัญชีเดิม — E-StockScan

1. เข้าสู่ระบบด้วย Username/Password เดิม
2. หน้า Mainpage กด “ผูกบัญชี LINE กับบัญชีเดิม”
3. ยืนยัน LINE Login ผ่าน LIFF และยืนยันชื่อ LINE ก่อนผูก
4. ระบบอัปเดตเฉพาะ LINE_USER_ID, LINE_DISPLAY_NAME, LINE_PICTURE_URL ในแถว USERS เดิม

ตั้งค่า LINE_CHANNEL_ID และ LINE_LIFF_ID บน Server และ LIFF ต้องเปิด Scope `openid` กับ `profile` พร้อม Endpoint URL ที่เข้าถึงได้ผ่าน HTTPS (เช่น ngrok ระหว่างทดสอบ localhost)
