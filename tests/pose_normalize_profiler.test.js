import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkPoseNormalize } from '../assets/js/pose_normalize_profiler.js';

describe('pose_normalize_profiler', () => {
  it('reports positive opsPerSec', () => {
    expect_ok: assert.ok(benchmarkPoseNormalize(64, 50).opsPerSec > 0);
  });
});
