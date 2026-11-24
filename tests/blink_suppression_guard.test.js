import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BlinkSuppressionGuard, BlinkState } from '../assets/js/blink_suppression_guard.js';

describe('BlinkSuppressionGuard Suite', () => {
  it('processes normal open eye tracking and clamps coordinates', () => {
    const guard = new BlinkSuppressionGuard();

    const frame1 = guard.processFrame({
      timestampMs: 1000,
      x: 0.45,
      y: 0.55,
      ear: 0.28,
      pupilDiameter: 3.8,
      confidence: 0.95,
    });

    assert.equal(frame1.valid, true);
    assert.equal(frame1.state, BlinkState.OPEN);
    assert.equal(frame1.x, 0.45);
    assert.equal(frame1.y, 0.55);
    assert.equal(frame1.isInterpolated, false);

    // Coordinates exceeding [0, 1] get clamped
    const frame2 = guard.processFrame({
      timestampMs: 1016,
      x: 1.2,
      y: -0.1,
      ear: 0.30,
      pupilDiameter: 4.0,
    });
    assert.equal(frame2.x, 1.0);
    assert.equal(frame2.y, 0.0);
  });

  it('detects blink onset and suppresses pupil occlusion artifacts', () => {
    const guard = new BlinkSuppressionGuard({ earThreshold: 0.20 });

    // Initial valid fixation
    guard.processFrame({
      timestampMs: 1000,
      x: 0.5,
      y: 0.5,
      ear: 0.3,
    });

    // Blink begins: EAR drops to 0.12
    const blinkFrame1 = guard.processFrame({
      timestampMs: 1033,
      x: 0.52,
      y: 0.48,
      ear: 0.12,
    });

    assert.equal(blinkFrame1.valid, true);
    assert.equal(blinkFrame1.isInterpolated, true);
    assert.equal(blinkFrame1.state, BlinkState.BLINK_ONSET);
    assert.equal(blinkFrame1.x, 0.5); // Interpolated from last valid frame
    assert.equal(blinkFrame1.y, 0.5);

    const metrics = guard.getTelemetryMetrics();
    assert.equal(metrics.blinksDetected, 1);
    assert.equal(metrics.suppressedArtifactFrames, 1);
  });

  it('interpolates short physiological blinks and transitions through recovery', () => {
    const guard = new BlinkSuppressionGuard({ maxInterpolationGapMs: 300 });

    // Establish pre-blink position
    guard.processFrame({ timestampMs: 1000, x: 0.3, y: 0.7, ear: 0.3 });

    // 4 blink frames across 100ms
    for (let i = 1; i <= 4; i++) {
      const f = guard.processFrame({
        timestampMs: 1000 + i * 25,
        x: NaN,
        y: NaN,
        ear: 0.05,
      });
      assert.equal(f.valid, true);
      assert.equal(f.isInterpolated, true);
      assert.equal(f.x, 0.3);
      assert.equal(f.y, 0.7);
    }

    // Reopening
    const reopen = guard.processFrame({
      timestampMs: 1150,
      x: 0.35,
      y: 0.65,
      ear: 0.28,
    });
    assert.equal(reopen.valid, true);
    assert.equal(reopen.state, BlinkState.BLINK_RECOVERY);
    assert.equal(reopen.isInterpolated, false);
    assert.equal(reopen.x, 0.35);

    // Next open frame
    const nextOpen = guard.processFrame({
      timestampMs: 1166,
      x: 0.36,
      y: 0.64,
      ear: 0.29,
    });
    assert.equal(nextOpen.state, BlinkState.OPEN);
  });

  it('triggers prolonged occlusion and halts interpolation on extended tracking loss', () => {
    const guard = new BlinkSuppressionGuard({
      maxInterpolationGapMs: 200,
      prolongedOcclusionThresholdMs: 400,
    });

    guard.processFrame({ timestampMs: 1000, x: 0.5, y: 0.5, ear: 0.3 });

    // Intermediate blink frames beyond 200ms gap
    const gapFrame = guard.processFrame({
      timestampMs: 1250,
      x: NaN,
      y: NaN,
      ear: 0.05,
    });
    assert.equal(gapFrame.valid, false);
    assert.equal(gapFrame.x, null);

    // Beyond prolonged occlusion threshold (400ms)
    const prolongedFrame = guard.processFrame({
      timestampMs: 1500,
      x: NaN,
      y: NaN,
      ear: 0.05,
    });
    assert.equal(prolongedFrame.state, BlinkState.PROLONGED_OCCLUSION);
    assert.equal(prolongedFrame.valid, false);

    const metrics = guard.getTelemetryMetrics();
    assert.equal(metrics.prolongedOcclusionEvents, 1);
  });

  it('triggers occlusion defense on collapsed pupil diameter and low confidence', () => {
    const guard = new BlinkSuppressionGuard({ pupilDiameterThreshold: 2.0, minConfidence: 0.4 });

    guard.processFrame({ timestampMs: 1000, x: 0.5, y: 0.5, ear: 0.3, pupilDiameter: 3.5, confidence: 0.9 });

    // Small pupil diameter
    const pdFrame = guard.processFrame({
      timestampMs: 1016,
      x: 0.5,
      y: 0.5,
      ear: 0.3,
      pupilDiameter: 1.0, // Below 2.0mm
      confidence: 0.9,
    });
    assert.equal(pdFrame.isInterpolated, true);

    // Low tracking confidence
    const confFrame = guard.processFrame({
      timestampMs: 1032,
      x: 0.5,
      y: 0.5,
      ear: 0.3,
      pupilDiameter: 3.5,
      confidence: 0.2, // Below 0.4
    });
    assert.equal(confFrame.isInterpolated, true);
  });

  it('defensively validates inputs and non-monotonic timestamps', () => {
    const guard = new BlinkSuppressionGuard();

    assert.throws(() => guard.processFrame(null), TypeError);
    assert.throws(() => guard.processFrame({ timestampMs: 'invalid' }), RangeError);

    guard.processFrame({ timestampMs: 2000, x: 0.5, y: 0.5 });

    // Backwards timestamp: returns last valid state without mutating timestamp
    const backwards = guard.processFrame({ timestampMs: 1950, x: 0.9, y: 0.9 });
    assert.equal(backwards.x, 0.5);
    assert.equal(backwards.y, 0.5);

    guard.reset();
    assert.equal(guard.metrics.totalFramesProcessed, 0);
  });
});
