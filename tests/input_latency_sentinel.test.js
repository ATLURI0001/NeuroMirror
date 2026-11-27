import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InputLatencySentinel } from '../assets/js/input_latency_sentinel.js';

describe('InputLatencySentinel', () => {
  it('passes within threshold', () => {
    const s = new InputLatencySentinel(100);
    s.check(40);
  });
  it('throws on excess latency', () => {
    const s = new InputLatencySentinel(50);
    assert.throws(() => s.check(80), /input latency exceeded/);
  });
});
