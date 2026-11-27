import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recordWebcamDrops, getAvgWebcamDrops } from '../assets/js/webcam_drop_rotary.js';

describe('webcam_drop_rotary', () => {
  it('tracks average dropped frames', () => {
    recordWebcamDrops(1);
    recordWebcamDrops(3);
    assert.equal(getAvgWebcamDrops(), 2);
  });
});
