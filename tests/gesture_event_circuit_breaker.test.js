import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GestureEventCircuitBreaker } from '../assets/js/gesture_event_circuit_breaker.js';

describe('GestureEventCircuitBreaker', () => {
  it('opens after threshold failures', () => {
    const cb = new GestureEventCircuitBreaker(2);
    const boom = () => { throw new Error('parse error'); };
    try { cb.process(boom); } catch {}
    try { cb.process(boom); } catch {}
    assert.throws(() => cb.process(() => {}), /gesture circuit open/);
  });
});
