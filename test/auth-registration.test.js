const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('shared USERS schema includes BRANCH_IDS and uses all 16 columns', () => {
  assert.match(server, /"BRANCH_IDS"/);
  assert.match(server, /getValues\("USERS!A:P"\)/);
  assert.match(server, /range:\s*"USERS!A:P"/);
});

test('LINE registration verifies ID token on server and creates Pending USER', () => {
  assert.match(server, /async function verifyLineIdToken/);
  assert.match(server, /const verifiedLine = await verifyLineIdToken\(body\.id_token\)/);
  assert.match(server, /STATUS:\s*"Pending"/);
  assert.match(server, /ROLE:\s*"USER"/);
  assert.match(server, /LINE_USER_ID:\s*lineUserId/);
});

test('password verifier accepts both shared scrypt hash formats', () => {
  assert.match(server, /value\.startsWith\("scrypt:"\)/);
  assert.match(server, /value\.startsWith\("scrypt\$"\)/);
});

test('registration UI requires LINE connection and submits verified ID token', () => {
  assert.match(page, /static\.line-scdn\.net\/liff\/edge\/2\/sdk\.js/);
  assert.match(page, /id="connectLineBtn"/);
  assert.match(page, /id_token:\s*registrationLineToken/);
});
