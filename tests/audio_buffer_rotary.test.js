import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AudioBufferRotary } from '../assets/js/audio_buffer_rotary.js';

describe('AudioBufferRotary', () => {
  it('caps at capacity', () => {
    const r = new AudioBufferRotary(3);
    for (let i = 0; i < 5; i++) r.record(i * 0.1);
    assert.equal(r.length, 3);
  });
});
