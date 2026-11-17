// Run against next dev. No LINE credentials are sent.
import assert from 'node:assert/strict';
const base = process.env.DEV_TEST_ORIGIN ?? 'http://localhost:3001';
const preference = await fetch(base + '/api/vehicle-preference');
assert.equal(preference.status, 200, 'Development needs no LINE session');
assert.equal((await preference.json()).model_id, 'other');
const save = await fetch(base + '/api/vehicle-preference', { method: 'PUT',
  headers: { Origin: base, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model_id: 'other' }) });
assert.equal(save.status, 200, 'Development settings need no remote account');
assert.notEqual((await fetch(base + '/api/sites/synthetic-site/parking-state')).status, 403,
  'Development map proxy must reach the vision API without LINE');
console.log('Development integration passed: preference, settings and map gate work without LINE.');
