import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LandmarkInferProfiler } from '../assets/js/landmarkInferProfiler.js';

describe('LandmarkInferProfiler', () => {
  it('computes avg latency', () => {
    const p = new LandmarkInferProfiler();
    p.record(8); p.record(12);
    assert.equal(p.avgMs(), 10);
  });
});
