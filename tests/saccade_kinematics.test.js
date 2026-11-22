import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SaccadeKinematicsGuard,
  KinematicMovementClass,
} from '../assets/js/saccade_kinematics.js';

describe('SaccadeKinematicsGuard Suite', () => {
  test('initializes with default options and clamps parameter boundaries', () => {
    const guard = new SaccadeKinematicsGuard();
    assert.equal(guard.pixelsPerDegree, 35.0);
    assert.equal(guard.microsaccadeMinVelocity, 30.0);
    assert.equal(guard.saccadeMinVelocity, 200.0);
    assert.equal(guard.maxSaccadeVelocity, 1200.0);

    const clamped = new SaccadeKinematicsGuard({
      pixelsPerDegree: -5,
      microsaccadeMinVelocity: -10,
      saccadeMinVelocity: 10,
      historyWindowMs: 50,
    });
    assert.equal(clamped.pixelsPerDegree, 35.0);
    assert.equal(clamped.microsaccadeMinVelocity, 30.0);
    assert.equal(clamped.historyWindowMs, 1000.0);
  });

  test('classifies steady fixation and tracks spatial BCEA dispersion', () => {
    const guard = new SaccadeKinematicsGuard({ pixelsPerDegree: 35.0 });

    // Stream 10 small jitter frames (within 1-2 pixels) at 50Hz (20ms intervals)
    let lastKin = null;
    for (let i = 0; i < 10; i++) {
      const x = 500 + Math.sin(i) * 1.5;
      const y = 400 + Math.cos(i) * 1.5;
      lastKin = guard.processFrame({ x, y, timestampMs: 1000 + i * 20 });
      assert.equal(lastKin.classification, KinematicMovementClass.FIXATION);
      assert.equal(lastKin.isBlink, false);
    }

    assert.ok(lastKin.bceaDegrees2 > 0.0);
    assert.ok(lastKin.velocityDegPerSec < 30.0);
  });

  test('detects high-velocity ballistic saccades and subsequent glissade', () => {
    const guard = new SaccadeKinematicsGuard({ pixelsPerDegree: 35.0 });

    // Baseline frame
    guard.processFrame({ x: 100, y: 100, timestampMs: 1000 });

    // Large ballistic jump: 350 pixels (10 degrees) in 25ms -> 400 deg/s
    const saccade = guard.processFrame({ x: 450, y: 100, timestampMs: 1025 });
    assert.equal(saccade.classification, KinematicMovementClass.SACCADE);
    assert.equal(saccade.velocityDegPerSec, 400.0);
    assert.ok(saccade.amplitudeDegrees >= 9.9);

    // Minor post-saccadic overshoot drift (glissade): 20 pixels in 40ms -> 14.3 deg/s
    const glissade = guard.processFrame({ x: 470, y: 100, timestampMs: 1065 });
    assert.equal(glissade.classification, KinematicMovementClass.GLISSADE);
  });

  test('detects microsaccadic movements', () => {
    const guard = new SaccadeKinematicsGuard({ pixelsPerDegree: 35.0 });

    guard.processFrame({ x: 200, y: 200, timestampMs: 1000 });

    // Shift of 35 pixels (1 degree) in 20ms -> 50 deg/s (between 30 and 200 deg/s)
    const micro = guard.processFrame({ x: 235, y: 200, timestampMs: 1020 });
    assert.equal(micro.classification, KinematicMovementClass.MICROSACCADE);
    assert.equal(micro.velocityDegPerSec, 50.0);
  });

  test('defensively handles blinks, non-monotonic timestamps, and NaN coordinates', () => {
    const guard = new SaccadeKinematicsGuard();

    // 1. Blink frame
    const blink = guard.processFrame({ x: 100, y: 100, timestampMs: 1000, pupilDiameter: 0.0 });
    assert.equal(blink.isBlink, true);
    assert.equal(blink.classification, KinematicMovementClass.UNKNOWN);

    // 2. Non-finite coordinate
    const nanRes = guard.processFrame({ x: NaN, y: 100, timestampMs: 1020 });
    assert.equal(nanRes.classification, KinematicMovementClass.UNKNOWN);

    // 3. Backward timestamp
    guard.processFrame({ x: 100, y: 100, timestampMs: 2000 });
    const backward = guard.processFrame({ x: 105, y: 100, timestampMs: 1950 });
    assert.equal(backward.classification, KinematicMovementClass.UNKNOWN);
  });

  test('resets internal trajectory history cleanly', () => {
    const guard = new SaccadeKinematicsGuard();
    guard.processFrame({ x: 100, y: 100, timestampMs: 1000 });
    guard.processFrame({ x: 102, y: 100, timestampMs: 1020 });
    assert.equal(guard.history.length, 2);

    guard.reset();
    assert.equal(guard.history.length, 0);
    assert.equal(guard.lastSample, null);
  });
});
