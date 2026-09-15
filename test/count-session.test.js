const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCountRows } = require('../countSession');

test('buildCountRows maps a confirmed scanned item into COUNT_SESSION columns', () => {
  const rows = buildCountRows([{
    session_id: 'S20260916-001',
    movement_id: 'MV001',
    code: 'EMER037',
    name: 'Syringe 20 ml',
    qty: 2,
    user: 'Nurse-A'
  }], '2026-09-16T10:00:00.000Z');

  assert.deepEqual(rows, [[
    'S20260916-001', 'MV001', 'EMER037', 'Syringe 20 ml', 2, 'Nurse-A', '2026-09-16T10:00:00.000Z'
  ]]);
});

test('buildCountRows ignores malformed items instead of writing broken COUNT_SESSION rows', () => {
  const rows = buildCountRows([
    null,
    { session_id: '', movement_id: 'MV002', code: 'EMER001', name: 'Suction', qty: 1, user: 'Nurse-A' },
    { session_id: 'S1', movement_id: 'MV003', code: 'EMER002', name: 'Item', qty: 0, user: 'Nurse-A' },
    { session_id: 'S1', movement_id: 'MV004', code: 'EMER003', name: 'Item 2', qty: 1, user: 'Nurse-A' }
  ], '2026-09-16T10:00:00.000Z');

  assert.deepEqual(rows, [[
    'S1', 'MV004', 'EMER003', 'Item 2', 1, 'Nurse-A', '2026-09-16T10:00:00.000Z'
  ]]);
});
