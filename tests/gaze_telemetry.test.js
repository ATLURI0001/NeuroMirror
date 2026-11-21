const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { GazeTelemetryRotary } = require('../assets/js/gaze_telemetry.js');

describe('GazeTelemetryRotary & Visual Attention Diagnostic Engine', () => {
  let rotary;

  beforeEach(() => {
    rotary = new GazeTelemetryRotary({
      windowDurationMs: 5000,
      minConfidenceThreshold: 0.6,
      optimalConfidenceThreshold: 0.85,
    });
  });

  it('records frames and computes metrics for optimal attentive tracking', () => {
    const baseTime = 10000;
    // 50 frames tightly clustered around (0.5, 0.5) over 2.5 seconds
    for (let i = 0; i < 50; i++) {
      rotary.recordFrame(
        {
          x: 0.5 + (i % 2 === 0 ? 0.01 : -0.01),
          y: 0.5 + (i % 2 === 0 ? 0.01 : -0.01),
          pupilMm: 3.5,
          confidence: 0.95,
          isBlink: false,
        },
        baseTime + i * 50
      );
    }

    const diag = rotary.evaluateDiagnostics();
    assert.equal(diag.status, 'OPTIMAL');
    assert.ok(diag.meanConfidence >= 0.9);
    assert.equal(diag.perclos, 0.0);
    assert.ok(diag.spatialDispersion < 0.05);
    assert.equal(diag.diagnostics.length, 0);
  });

  it('detects DEGRADED tracking on elevated drowsiness and dispersion', () => {
    const baseTime = 10000;
    // 50 frames with 10 blinks (20% PERCLOS) and larger dispersion
    for (let i = 0; i < 50; i++) {
      const isBlink = i % 5 === 0;
      rotary.recordFrame(
        {
          x: 0.2 + (i * 0.01),
          y: 0.2 + (i * 0.01),
          pupilMm: 3.2,
          confidence: 0.88,
          isBlink,
        },
        baseTime + i * 50
      );
    }

    const diag = rotary.evaluateDiagnostics();
    assert.equal(diag.status, 'DEGRADED');
    assert.ok(diag.perclos >= 0.15);
    assert.ok(diag.diagnostics.some((d) => d.includes('Elevated eye closure')));
  });

  it('detects UNRELIABLE status when confidence collapses', () => {
    const baseTime = 10000;
    for (let i = 0; i < 20; i++) {
      rotary.recordFrame(
        {
          x: 0.5,
          y: 0.5,
          confidence: 0.35, // Low confidence
          isBlink: false,
        },
        baseTime + i * 50
      );
    }

    const diag = rotary.evaluateDiagnostics();
    assert.equal(diag.status, 'UNRELIABLE');
    assert.ok(diag.meanConfidence < 0.6);
    assert.ok(diag.diagnostics.some((d) => d.includes('Tracking confidence critically low')));
  });

  it('evicts stale frames outside the sliding window duration', () => {
    const baseTime = 10000;
    rotary.recordFrame({ x: 0.5, y: 0.5 }, baseTime);
    assert.equal(rotary.frames.length, 1);

    // Record frame 6000ms later (> 5000ms window)
    rotary.recordFrame({ x: 0.5, y: 0.5 }, baseTime + 6000);
    assert.equal(rotary.frames.length, 1);
    assert.equal(rotary.frames[0].timestamp, baseTime + 6000);
  });
});
