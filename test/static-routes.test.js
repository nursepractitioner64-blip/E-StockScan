const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const server = fs.readFileSync('server.js', 'utf8');

test('admin management routes are present and protected', () => {
  assert.match(server, /app\.get\("\/api\/admin\/users", requireAdmin/);
  assert.match(server, /app\.patch\("\/api\/admin\/users\/:userId\/approve", requireAdmin/);
  assert.match(server, /app\.patch\("\/api\/admin\/users\/:userId\/reject", requireAdmin/);
  assert.match(server, /app\.patch\("\/api\/admin\/users\/:userId\/status", requireAdmin/);
});

test('registration creates pending non-admin users', () => {
  assert.match(server, /STATUS: "Pending"/);
  assert.match(server, /ROLE: "USER"/);
});

test('login returns the safe user object without password hash', () => {
  assert.match(server, /user: \{\n        \.\.\.safeUser\(user\)/);
  assert.doesNotMatch(server, /safeUser\(user\)[\s\S]{0,200}PASSWORD_HASH/);
});
