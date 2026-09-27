import assert from 'node:assert/strict';
import test from 'node:test';
import { obstructionLabel } from './parkingMapLabels.ts';

void test('obstruction labels retain source detection index and semantic suffix', () => {
  assert.equal(obstructionLabel({ detection_index: 46, source_type: 'UNASSIGNED_OBSTRUCTION' }), '#46 ?');
  assert.equal(obstructionLabel({ detection_index: 40, source_type: 'AMBIGUOUS_OBSTRUCTION' }), '#40 !');
  assert.equal(obstructionLabel({ detection_index: 12, source_type: 'EXTERNAL_OBSTRUCTION' }), '#12 EXT');
});
