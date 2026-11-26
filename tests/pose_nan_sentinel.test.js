import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertValidPoseLandmarks } from '../assets/js/pose_nan_sentinel.js';

describe('pose_nan_sentinel', () => {
  it('accepts finite landmarks and rejects NaN', () => {
    assert.doesNotThrow(() => assertValidPoseLandmarks([{ x: 0.5, y: 0.5 }]));
    assert.throws(() => assertValidPoseLandmarks([{ x: NaN, y: 0.5 }]));
  });
});
