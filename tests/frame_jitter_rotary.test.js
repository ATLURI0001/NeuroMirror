import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recordFrameJitter, getJitterStats } from '../assets/js/frame_jitter_rotary.js';

describe('frame_jitter_rotary', () => {
  it('records jitter samples and computes stats', () => {
    recordFrameJitter(4);
    recordFrameJitter(8);
    const s = getJitterStats();
    assert.equal(s.count, 2);
    assert.equal(s.avgMs, 6);
    assert.equal(s.maxMs, 8);
  });
});
