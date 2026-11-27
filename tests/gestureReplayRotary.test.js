import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GestureReplayRotary } from '../assets/js/gestureReplayRotary.js';

describe('GestureReplayRotary', () => {
  it('evicts oldest when full', () => {
    const r = new GestureReplayRotary(3);
    r.push('a'); r.push('b'); r.push('c'); r.push('d');
    assert.equal(r.count(), 3);
    assert.ok(!r.latest().includes('a'));
  });
});
