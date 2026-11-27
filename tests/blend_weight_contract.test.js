import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateBlendWeight } from '../assets/js/blend_weight_contract.js';

describe('blend_weight_contract', () => {
  it('enforces [0, 1] bounds', () => {
    assert.equal(validateBlendWeight(0.5), true);
    assert.throws(() => validateBlendWeight(1.5));
  });
});
