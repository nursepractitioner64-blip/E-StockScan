const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeRole,
  isAdmin,
  normalizeStatus,
  buildUserPatch
} = require('../lib/user-management');

test('missing role defaults to USER and never grants admin', () => {
  assert.equal(normalizeRole(''), 'USER');
  assert.equal(normalizeRole(undefined), 'USER');
  assert.equal(isAdmin({ ROLE: '' }), false);
  assert.equal(isAdmin({ ROLE: 'USER' }), false);
});

test('ADMIN role is recognized case-insensitively', () => {
  assert.equal(normalizeRole('admin'), 'ADMIN');
  assert.equal(isAdmin({ ROLE: 'admin' }), true);
});

test('status normalization keeps only supported management statuses', () => {
  assert.equal(normalizeStatus('active'), 'Active');
  assert.equal(normalizeStatus('REJECTED'), 'Rejected');
  assert.equal(normalizeStatus('inactive'), 'Inactive');
  assert.equal(normalizeStatus('pending'), null);
  assert.equal(normalizeStatus('deleted'), null);
});

test('buildUserPatch only changes explicitly requested safe fields', () => {
  assert.deepEqual(buildUserPatch({ STATUS: 'Active' }), { STATUS: 'Active' });
  assert.deepEqual(buildUserPatch({ ROLE: 'ADMIN', PASSWORD_HASH: 'secret' }), { ROLE: 'ADMIN' });
  assert.deepEqual(buildUserPatch({ status: 'Rejected', role: 'admin' }), {
    STATUS: 'Rejected',
    ROLE: 'ADMIN'
  });
});
