import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CircuitState,
  FallbackStrategy,
  GazeDropoutCircuitBreaker,
} from '../assets/js/gaze_dropout_circuit_breaker.js';

describe('GazeDropoutCircuitBreaker Suite', () => {
  it('passes nominal frames in CLOSED state without interpolation', () => {
    const cb = new GazeDropoutCircuitBreaker({ dropoutThreshold: 3 });

    const res = cb.processFrame({ x: 200, y: 350, confidence: 0.95 });
    assert.equal(res.circuitState, CircuitState.CLOSED);
    assert.equal(res.strategy, FallbackStrategy.PASSTHROUGH);
    assert.equal(res.interpolated, false);
    assert.equal(res.x, 200);
    assert.equal(res.y, 350);
  });

  it('interpolates single dropout frame without tripping immediately', () => {
    const cb = new GazeDropoutCircuitBreaker({ dropoutThreshold: 3 });
    cb.processFrame({ x: 100, y: 100, confidence: 0.9 }, 1000);

    // Frame with null or NaN triggers dropout
    const res = cb.processFrame({ x: NaN, y: NaN }, 1016);
    assert.equal(res.circuitState, CircuitState.CLOSED);
    assert.equal(res.strategy, FallbackStrategy.DEAD_RECKONING);
    assert.equal(res.interpolated, true);
    assert.equal(cb.state, CircuitState.CLOSED);
  });

  it('trips to OPEN state when consecutive dropouts reach threshold', () => {
    const cb = new GazeDropoutCircuitBreaker({ dropoutThreshold: 3, recoveryWindowMs: 200 });
    cb.processFrame({ x: 100, y: 100, confidence: 0.9 }, 1000);

    cb.processFrame(null, 1016); // 1
    cb.processFrame(null, 1032); // 2
    const res3 = cb.processFrame(null, 1048); // 3 -> trip to OPEN!

    assert.equal(res3.circuitState, CircuitState.OPEN);
    assert.equal(cb.state, CircuitState.OPEN);
    assert.equal(cb.tripCount, 1);
  });

  it('transitions from OPEN to HALF_OPEN after recovery window and smoothly blends', () => {
    const cb = new GazeDropoutCircuitBreaker({
      dropoutThreshold: 2,
      recoveryWindowMs: 100,
      halfOpenSuccessThreshold: 2,
    });

    cb.processFrame({ x: 50, y: 50, confidence: 0.9 }, 1000);
    cb.processFrame(null, 1016);
    cb.processFrame(null, 1032); // Trips to OPEN
    assert.equal(cb.state, CircuitState.OPEN);

    // Feed a frame before recovery timeout (1032 + 50 = 1082 < 1132) -> still OPEN
    cb.processFrame(null, 1082);
    assert.equal(cb.state, CircuitState.OPEN);

    // Recovery window passed (now = 1150) -> transitions to HALF_OPEN on valid frame
    const probe1 = cb.processFrame({ x: 60, y: 60, confidence: 0.8 }, 1150);
    assert.equal(probe1.circuitState, CircuitState.HALF_OPEN);
    assert.equal(probe1.strategy, FallbackStrategy.INTERPOLATED_CANARY);

    // 2nd successful canary frame -> returns to CLOSED!
    const probe2 = cb.processFrame({ x: 62, y: 62, confidence: 0.85 }, 1166);
    assert.equal(cb.state, CircuitState.CLOSED);
    assert.equal(probe2.strategy, FallbackStrategy.INTERPOLATED_CANARY);
  });

  it('immediately re-trips to OPEN on failure during HALF_OPEN canary phase', () => {
    const cb = new GazeDropoutCircuitBreaker({
      dropoutThreshold: 2,
      recoveryWindowMs: 50,
      halfOpenSuccessThreshold: 3,
    });

    cb.processFrame({ x: 10, y: 10, confidence: 0.9 }, 1000);
    cb.processFrame(null, 1010);
    cb.processFrame(null, 1020); // Trips to OPEN

    // Transition to HALF_OPEN
    cb.processFrame({ x: 15, y: 15, confidence: 0.8 }, 1080);
    assert.equal(cb.state, CircuitState.HALF_OPEN);

    // Dropout during HALF_OPEN -> immediate re-trip!
    cb.processFrame(null, 1090);
    assert.equal(cb.state, CircuitState.OPEN);
    assert.equal(cb.tripCount, 2);
  });

  it('rejects invalid constructor parameters defensively', () => {
    assert.throws(() => new GazeDropoutCircuitBreaker({ dropoutThreshold: 0 }), /dropoutThreshold must be >= 1/);
    assert.throws(() => new GazeDropoutCircuitBreaker({ recoveryWindowMs: -10 }), /recoveryWindowMs must be positive/);
    assert.throws(() => new GazeDropoutCircuitBreaker({ halfOpenSuccessThreshold: 0 }), /halfOpenSuccessThreshold must be >= 1/);
  });

  it('resets state cleanly', () => {
    const cb = new GazeDropoutCircuitBreaker({ dropoutThreshold: 2 });
    cb.processFrame(null);
    cb.processFrame(null);
    assert.equal(cb.state, CircuitState.OPEN);

    cb.reset();
    assert.equal(cb.state, CircuitState.CLOSED);
    assert.equal(cb.consecutiveDropouts, 0);
  });
});
