import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SaccadeTelemetryRotary,
  ATTENTION_STATES,
} from '../assets/js/saccade_telemetry.js';

test('SaccadeTelemetryRotary: initial state and empty queries', () => {
  const rotary = new SaccadeTelemetryRotary();
  const lat = rotary.computeLatencyStats();
  assert.equal(lat.sampleCount, 0);
  assert.equal(lat.p50Ms, 0.0);

  const disp = rotary.computeVisualDispersion();
  assert.equal(disp.sampleCount, 0);
  assert.equal(disp.dispersionRadiusPx, 0.0);

  const state = rotary.evaluateAttentionState();
  assert.equal(state, ATTENTION_STATES.OPTIMAL);
});

test('SaccadeTelemetryRotary: records saccade and computes amplitude and latency', () => {
  const rotary = new SaccadeTelemetryRotary();
  const event = rotary.recordSaccade({
    stimulusTimestamp: 1000,
    onsetTimestamp: 1220,
    startPos: { x: 100, y: 100 },
    endPos: { x: 130, y: 140 }, // dx=30, dy=40 -> amplitude=50
    peakVelocityDegPerSec: 420.5,
  });

  assert.equal(event.latencyMs, 220.0);
  assert.equal(event.amplitudePx, 50.0);
  assert.equal(event.peakVelocityDegPerSec, 420.5);

  // Negative latency throws
  assert.throws(() => {
    rotary.recordSaccade({
      stimulusTimestamp: 2000,
      onsetTimestamp: 1900,
      startPos: { x: 0, y: 0 },
      endPos: { x: 10, y: 10 },
    });
  }, RangeError);
});

test('SaccadeTelemetryRotary: computes accurate latency percentiles', () => {
  const rotary = new SaccadeTelemetryRotary();

  // Insert latencies from 100ms to 500ms in 50ms increments
  for (let i = 1; i <= 9; i++) {
    const lat = 100 + i * 40; // 140, 180, 220, 260, 300, 340, 380, 420, 460
    rotary.recordSaccade({
      stimulusTimestamp: 1000,
      onsetTimestamp: 1000 + lat,
      startPos: { x: 0, y: 0 },
      endPos: { x: 10, y: 10 },
    });
  }

  const stats = rotary.computeLatencyStats();
  assert.equal(stats.sampleCount, 9);
  assert.equal(stats.minMs, 140.0);
  assert.equal(stats.maxMs, 460.0);
  assert.equal(stats.p50Ms, 300.0);
  assert.equal(stats.meanMs, 300.0);
});

test('SaccadeTelemetryRotary: computes visual dispersion and BCEA', () => {
  const rotary = new SaccadeTelemetryRotary();

  // Record 4 fixations in a square: (10, 10), (10, 30), (30, 10), (30, 30)
  rotary.recordFixation({ timestamp: 1000, x: 10, y: 10 });
  rotary.recordFixation({ timestamp: 1100, x: 10, y: 30 });
  rotary.recordFixation({ timestamp: 1200, x: 30, y: 10 });
  rotary.recordFixation({ timestamp: 1300, x: 30, y: 30 });

  const disp = rotary.computeVisualDispersion();
  assert.equal(disp.sampleCount, 4);
  assert.equal(disp.centroidX, 20.0);
  assert.equal(disp.centroidY, 20.0);
  assert.equal(disp.dispersionRadiusPx, 14.14); // sqrt(200)
  assert.ok(disp.bceaAreaPx2 > 0);
});

test('SaccadeTelemetryRotary: classifies attention states across thresholds', () => {
  const t0 = 10000;

  // Optimal
  const rOpt = new SaccadeTelemetryRotary({ fatigueLatencyThresholdMs: 300, impairmentLatencyThresholdMs: 400 });
  rOpt.recordSaccade({ stimulusTimestamp: t0, onsetTimestamp: t0 + 200, startPos: { x: 0, y: 0 }, endPos: { x: 5, y: 5 } });
  rOpt.recordSaccade({ stimulusTimestamp: t0 + 500, onsetTimestamp: t0 + 720, startPos: { x: 0, y: 0 }, endPos: { x: 5, y: 5 } });
  assert.equal(rOpt.evaluateAttentionState(30000, t0 + 1000), ATTENTION_STATES.OPTIMAL);

  // Fatigued (median latency > 300ms)
  const rFat = new SaccadeTelemetryRotary({ fatigueLatencyThresholdMs: 300, impairmentLatencyThresholdMs: 400 });
  rFat.recordSaccade({ stimulusTimestamp: t0, onsetTimestamp: t0 + 350, startPos: { x: 0, y: 0 }, endPos: { x: 5, y: 5 } });
  rFat.recordSaccade({ stimulusTimestamp: t0 + 500, onsetTimestamp: t0 + 860, startPos: { x: 0, y: 0 }, endPos: { x: 5, y: 5 } });
  assert.equal(rFat.evaluateAttentionState(30000, t0 + 1000), ATTENTION_STATES.FATIGUED);

  // Impaired (median latency > 400ms)
  const rImp = new SaccadeTelemetryRotary({ fatigueLatencyThresholdMs: 300, impairmentLatencyThresholdMs: 400 });
  rImp.recordSaccade({ stimulusTimestamp: t0, onsetTimestamp: t0 + 450, startPos: { x: 0, y: 0 }, endPos: { x: 5, y: 5 } });
  rImp.recordSaccade({ stimulusTimestamp: t0 + 500, onsetTimestamp: t0 + 980, startPos: { x: 0, y: 0 }, endPos: { x: 5, y: 5 } });
  assert.equal(rImp.evaluateAttentionState(30000, t0 + 1000), ATTENTION_STATES.IMPAIRED);
});

test('SaccadeTelemetryRotary: formats markdown diagnostic report', () => {
  const rotary = new SaccadeTelemetryRotary();
  rotary.recordSaccade({ stimulusTimestamp: 1000, onsetTimestamp: 1220, startPos: { x: 10, y: 10 }, endPos: { x: 50, y: 50 } });
  rotary.recordFixation({ timestamp: 1220, x: 50, y: 50 });

  const md = rotary.formatMarkdownReport(1300);
  assert.ok(md.includes('# Ocular Saccade & Visual Dispersion Rotary Telemetry'));
  assert.ok(md.includes('**Attention State**: `OPTIMAL`'));
  assert.ok(md.includes('220 ms'));
});
