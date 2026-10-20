const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
test('existing account LINE link is authenticated and server-verifies ID token', () => {
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(server, /app\.post\("\/api\/auth\/line\/link", requireAuth/);
  assert.match(server, /verifyLineIdToken\(req\.body\?\.id_token\)/);
  assert.match(server, /LINE_USER_ID: line\.user_id/);
  assert.match(server, /LINE_DISPLAY_NAME: line\.display_name/);
  assert.match(server, /LINE_PICTURE_URL: line\.picture_url/);
  assert.match(server, /บัญชี LINE นี้ผูกกับผู้ใช้งานอื่นแล้ว/);
});
test('E-StockScan main page exposes authenticated account linking UI', () => {
  const page = fs.readFileSync(path.join(root, 'public', 'mainpage.html'), 'utf8');
  assert.match(page, /id="linkLineBtn"/);
  assert.match(page, /\/api\/auth\/line\/status/);
  assert.match(page, /\/api\/auth\/line\/link/);
});
