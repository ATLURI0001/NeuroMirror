import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FixationTelemetryCollector } from '../assets/js/fixation_telemetry.js';

test('FixationTelemetryCollector: processes normal fixation stream', () => {
  const collector = new FixationTelemetryCollector({ driftThresholdPx: 30.0 });

  // Generate 20 samples simulating stable fixation around (500, 300) with small jitter
  const baseTime = 1000;
  for (let i = 0; i < 20; i++) {
    collector.recordSample({
      x: 500 + Math.sin(i) * 0.3,
      y: 300 + Math.cos(i) * 0.3,
      timestamp: baseTime + i * 20, // 50 Hz (20ms step)
      confidence: 0.95,
    });
  }

  const report = collector.getTelemetryReport();
  assert.equal(report.totalSamplesProcessed, 20);
  assert.equal(report.lowConfidenceDrops, 0);
  assert.equal(report.totalFixations, 1);
  assert.ok(report.meanDispersionRadiusPx > 0 && report.meanDispersionRadiusPx < 10);
  assert.equal(report.isDegraded, false);
});

test('FixationTelemetryCollector: rejects invalid samples and filters low confidence', () => {
  const collector = new FixationTelemetryCollector({ minConfidence: 0.7 });

  assert.throws(
    () => collector.recordSample(null),
    /Invalid gaze sample/
  );

  assert.throws(
    () => collector.recordSample({ x: NaN, y: 100, timestamp: 1000 }),
    /Invalid gaze sample/
  );

  // Low confidence sample dropped
  const dropped = collector.recordSample({ x: 200, y: 200, timestamp: 1000, confidence: 0.3 });
  assert.equal(dropped, null);

  const report = collector.getTelemetryReport();
  assert.equal(report.totalSamplesProcessed, 1);
  assert.equal(report.lowConfidenceDrops, 1);
});

test('FixationTelemetryCollector: detects microsaccades within fixation', () => {
  const collector = new FixationTelemetryCollector({ driftThresholdPx: 40.0 });
  const t0 = 2000;

  // Add 10 baseline samples
  for (let i = 0; i < 10; i++) {
    collector.recordSample({ x: 100, y: 100, timestamp: t0 + i * 20 });
  }

  // Inject a micro-jump: 10px jump in 20ms (velocity = 500 px/sec is saccade, let's use 3px in 20ms = 150 px/sec)
  collector.recordSample({ x: 103, y: 100, timestamp: t0 + 200 });
  collector.recordSample({ x: 100, y: 100, timestamp: t0 + 220 });

  // Add 10 more baseline samples
  for (let i = 12; i < 22; i++) {
    collector.recordSample({ x: 100, y: 100, timestamp: t0 + i * 20 });
  }

  const report = collector.getTelemetryReport();
  assert.ok(report.totalMicrosaccades >= 1);
  assert.equal(report.totalFixations, 1);
});

test('FixationTelemetryCollector: transitions fixation on large saccade leap', () => {
  const collector = new FixationTelemetryCollector({ driftThresholdPx: 30.0 });
  const t0 = 5000;

  // Fixation 1 at (100, 100)
  for (let i = 0; i < 10; i++) {
    collector.recordSample({ x: 100 + i * 0.2, y: 100, timestamp: t0 + i * 20 });
  }

  // Large saccadic jump to (800, 600)
  collector.recordSample({ x: 800, y: 600, timestamp: t0 + 220 });

  // Fixation 2 at (800, 600)
  for (let i = 1; i <= 10; i++) {
    collector.recordSample({ x: 800 + i * 0.2, y: 600, timestamp: t0 + 220 + i * 20 });
  }

  const report = collector.getTelemetryReport();
  assert.equal(report.totalFixations, 2);
});

test('FixationTelemetryCollector: triggers degradation diagnostic on excessive microsaccade burst', () => {
  const collector = new FixationTelemetryCollector({ maxMicrosaccadeRateHz: 2.0 });
  const t0 = 10000;

  // Rapid micro-jitters
  for (let i = 0; i < 30; i++) {
    const shift = (i % 2 === 0) ? 3 : 0;
    collector.recordSample({ x: 100 + shift, y: 100, timestamp: t0 + i * 30 });
  }

  const report = collector.getTelemetryReport();
  assert.ok(report.isDegraded);
  assert.ok(report.warnings.some(w => w.includes('Elevated microsaccade frequency')));
});

test('FixationTelemetryCollector: exports valid Prometheus metrics format', () => {
  const collector = new FixationTelemetryCollector();
  collector.recordSample({ x: 250, y: 250, timestamp: 1000 });
  collector.recordSample({ x: 252, y: 251, timestamp: 1020 });

  const prom = collector.toPrometheusMetrics();
  assert.ok(prom.includes('neuromirror_ocular_samples_total 2'));
  assert.ok(prom.includes('neuromirror_fixations_total 1'));
  assert.ok(prom.includes('# TYPE neuromirror_oculomotor_degraded gauge'));
});
