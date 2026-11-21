import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SaccadeProfiler, GazeMovementType } from '../assets/js/saccade_profiler.js';

describe('SaccadeProfiler', () => {
  it('should classify slow gaze drift as FIXATION and apply exponential stabilization', () => {
    const profiler = new SaccadeProfiler({
      fixationVelocityThreshold: 30.0,
      pixelsPerDegree: 35.0,
      driftAlpha: 0.2,
    });

    // Initial anchor
    const r1 = profiler.processSample(500, 500, 1.0);
    assert.equal(r1.movementType, GazeMovementType.FIXATION);
    assert.equal(r1.stabilizedX, 500);

    // Micro-jitter: +2 pixels in 0.05s (40 px/s = ~1.14 deg/s < 30 deg/s)
    const r2 = profiler.processSample(502, 501, 1.05);
    assert.equal(r2.movementType, GazeMovementType.FIXATION);
    assert.ok(r2.velocityDegSec < 30.0);
    // Stabilized position should smooth the jump
    assert.ok(r2.stabilizedX > 500 && r2.stabilizedX < 502);
  });

  it('should detect high-velocity ballistic SACCADES without low-pass lag', () => {
    const profiler = new SaccadeProfiler({
      saccadeVelocityThreshold: 300.0,
      pixelsPerDegree: 35.0,
    });

    // Anchor at (100, 100)
    profiler.processSample(100, 100, 1.0);

    // Ballistic jump: 600 pixels in 0.02s (30,000 px/s = ~857 deg/s >= 300 deg/s)
    const r = profiler.processSample(700, 100, 1.02);
    assert.equal(r.movementType, GazeMovementType.SACCADE);
    assert.ok(r.velocityDegSec >= 300.0);
    assert.equal(r.stabilizedX, 700); // Raw tracking without lag
    assert.equal(profiler.saccadeCount, 1);
  });

  it('should classify intermediate velocities as SMOOTH_PURSUIT', () => {
    const profiler = new SaccadeProfiler({
      fixationVelocityThreshold: 30.0,
      saccadeVelocityThreshold: 300.0,
      pixelsPerDegree: 35.0,
    });

    profiler.processSample(100, 100, 1.0);

    // Medium pursuit: 70 pixels in 0.02s (3500 px/s = 100 deg/s)
    const r = profiler.processSample(170, 100, 1.02);
    assert.equal(r.movementType, GazeMovementType.SMOOTH_PURSUIT);
    assert.ok(r.velocityDegSec >= 30.0 && r.velocityDegSec < 300.0);
  });

  it('should defensively guard discontinuous timestamps and non-finite coordinates', () => {
    const profiler = new SaccadeProfiler();
    profiler.processSample(100, 100, 1.0);

    // Large time gap (10 seconds) resets anchor safely
    const r1 = profiler.processSample(200, 200, 11.0);
    assert.equal(r1.movementType, GazeMovementType.FIXATION);
    assert.equal(r1.velocityDegSec, 0.0);

    // Non-finite input
    const r2 = profiler.processSample(NaN, Infinity, 11.05);
    assert.equal(r2.velocityDegSec, 0.0);
  });
});
