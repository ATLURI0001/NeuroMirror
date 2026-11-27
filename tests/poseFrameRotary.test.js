import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PoseFrameRotary } from '../assets/js/poseFrameRotary.js';

describe('PoseFrameRotary', () => {
  it('bounds frame buffer', () => {
    const r = new PoseFrameRotary(2);
    r.push(1); r.push(2); r.push(3);
    assert.equal(r.count(), 2);
  });
});
