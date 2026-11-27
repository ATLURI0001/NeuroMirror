import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AudioSyncCircuitBreaker } from '../assets/js/audio_sync_circuit_breaker.js';

describe('AudioSyncCircuitBreaker', () => {
  it('opens after consecutive failures', () => {
    const cb = new AudioSyncCircuitBreaker(2, 5000);
    assert.throws(() => cb.call(() => { throw new Error('audio err'); }));
    assert.throws(() => cb.call(() => { throw new Error('audio err'); }));
    assert.throws(() => cb.call(() => 'ok'), /circuit open/);
  });
});
