const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { app } = require('../server');

function request(server, path) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request({
      hostname: '127.0.0.1',
      port: address.port,
      path,
      method: 'GET'
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('unauthenticated auth/me returns 401', async () => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const result = await request(server, '/api/auth/me');
    assert.equal(result.status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('unauthenticated admin users endpoint returns 401', async () => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const result = await request(server, '/api/admin/users');
    assert.equal(result.status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
