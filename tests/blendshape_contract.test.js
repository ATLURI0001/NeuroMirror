const test = require('node:test');
const assert = require('node:assert/strict');
const { BlendshapeContract } = require('../assets/js/blendshape_contract.js');

test('BlendshapeContract - validates [0, 1] range and rejects NaN/out-of-bounds', () => {
  assert.equal(BlendshapeContract.validate({ jawOpen: 0.4, browInnerUp: 0.9 }).valid, true);
  const bad = BlendshapeContract.validate({ jawOpen: 1.5, eyeBlinkLeft: NaN });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.includes('ERR_COEFFICIENT_OUT_OF_RANGE:jawOpen'));
  assert.ok(bad.errors.includes('ERR_COEFFICIENT_OUT_OF_RANGE:eyeBlinkLeft'));
});
