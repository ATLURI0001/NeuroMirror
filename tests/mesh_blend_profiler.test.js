import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkMeshBlend } from '../assets/js/mesh_blend_profiler.js';

describe('mesh_blend_profiler', () => {
  it('reports positive opsPerSec', () => {
    const res = benchmarkMeshBlend(128, 50);
    assert.ok(res.opsPerSec > 0);
  });
});
