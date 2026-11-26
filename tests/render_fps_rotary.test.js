import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recordRenderFps, getAvgFps } from '../assets/js/render_fps_rotary.js';

describe('render_fps_rotary', () => {
  it('computes average FPS', () => {
    recordRenderFps(30);
    recordRenderFps(60);
    assert.equal(getAvgFps(), 45);
  });
});
