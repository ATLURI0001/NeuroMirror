import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WebcamStreamCircuitBreaker } from '../assets/js/webcam_stream_circuit_breaker.js';

describe('WebcamStreamCircuitBreaker', () => {
  it('opens after consecutive failures', () => {
    const cb = new WebcamStreamCircuitBreaker(2, 5000);
    assert.throws(() => cb.call(() => { throw new Error('cam err'); }));
    assert.throws(() => cb.call(() => { throw new Error('cam err'); }));
    assert.throws(() => cb.call(() => 'ok'), /circuit open/);
  });
});
