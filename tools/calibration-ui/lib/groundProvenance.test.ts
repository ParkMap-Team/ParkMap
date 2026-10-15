import assert from 'node:assert/strict';
import test from 'node:test';
import { provenanceProblem, withProvenance } from './groundProvenance.ts';

const estimate = { provenance: 'ESTIMATED' as const, uncertainty_m: 0.5, estimation_basis: 'Scaled from average motorcycle length.' };

void test('switching to MEASURED drops the estimation basis but keeps the other fields', () => {
  assert.deepEqual(withProvenance({ id: 'P1', ...estimate }, 'MEASURED'), { id: 'P1', provenance: 'MEASURED', uncertainty_m: 0.5, estimation_basis: null });
});

void test('switching to ESTIMATED keeps any uncertainty already entered', () => {
  assert.deepEqual(withProvenance({ id: 'P1', provenance: 'MEASURED' as const, uncertainty_m: 0.05 }, 'ESTIMATED'), { id: 'P1', provenance: 'ESTIMATED', uncertainty_m: 0.05 });
});

void test('an estimate must state a positive uncertainty and a basis', () => {
  assert.equal(provenanceProblem(estimate), null);
  assert.equal(provenanceProblem({ provenance: 'MEASURED' }), null);
  assert.match(provenanceProblem({ ...estimate, uncertainty_m: null }) ?? '', /uncertainty/);
  assert.match(provenanceProblem({ ...estimate, uncertainty_m: 0 }) ?? '', /uncertainty/);
  assert.match(provenanceProblem({ ...estimate, estimation_basis: '  ' }) ?? '', /basis/);
});
