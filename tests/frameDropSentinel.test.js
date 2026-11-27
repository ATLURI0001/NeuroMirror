import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FrameDropSentinel } from '../assets/js/frameDropSentinel.js';

describe('FrameDropSentinel', () => {
  it('flags excessive frame drops', () => {
    const s = new FrameDropSentinel(3);
    assert.equal(s.check(2), true);
    assert.equal(s.check(6), false);
    assert.equal(s.alerts(), 1);
  });
});
