import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CognitiveLoadEstimator } from '../assets/js/cognitive_load.js';

describe('CognitiveLoadEstimator & Pupillary Response Suite', () => {
  test('initializes with default options and uncalibrated state', () => {
    const estimator = new CognitiveLoadEstimator();
    const telemetry = estimator.getTelemetry();

    assert.equal(telemetry.totalSamples, 0);
    assert.equal(telemetry.blinksFiltered, 0);
    assert.equal(telemetry.currentLoadLevel, 'LOW');
    assert.equal(telemetry.bufferedSampleCount, 0);
  });

  test('filters blink and out-of-bounds pupil diameter samples', () => {
    const estimator = new CognitiveLoadEstimator({ minPupilMm: 1.5, maxPupilMm: 8.5 });

    // Blink (0mm aperture / zero pupil)
    const blinkRes = estimator.recordSample(1000, 0.0);
    assert.equal(blinkRes.isBlink, true);

    // Negative and NaN
    assert.equal(estimator.recordSample(1033, -1.0).isBlink, true);
    assert.equal(estimator.recordSample(1066, NaN).isBlink, true);
    assert.equal(estimator.recordSample(1100, 10.0).isBlink, true); // Above 8.5mm

    const telemetry = estimator.getTelemetry();
    assert.equal(telemetry.totalSamples, 4);
    assert.equal(telemetry.blinksFiltered, 4);
  });

  test('calibrates baseline on initial valid sample', () => {
    const estimator = new CognitiveLoadEstimator();
    const res = estimator.recordSample(1000, 3.8);

    assert.equal(res.isBlink, false);
    assert.equal(estimator.isCalibrated, true);
    assert.equal(estimator.baselinePupilMm, 3.8);
    assert.equal(res.dilationMm, 0.0);
  });

  test('classifies NOMINAL cognitive load under resting baseline conditions', () => {
    const estimator = new CognitiveLoadEstimator({ windowMs: 5000 });
    let time = 1000;

    // Steady resting state: ~3.5mm with mild physiological tremor (+/- 0.05)
    for (let i = 0; i < 20; i++) {
      time += 50;
      const jitter = (i % 2 === 0 ? 0.02 : -0.02);
      estimator.recordSample(time, 3.5 + jitter);
    }

    const telemetry = estimator.getTelemetry();
    assert.ok(telemetry.currentLoadLevel === 'NOMINAL' || telemetry.currentLoadLevel === 'LOW');
    assert.ok(telemetry.currentZScore < 1.2);
  });

  test('detects HIGH and OVERLOAD cognitive load on sudden task-evoked pupil dilation', () => {
    const estimator = new CognitiveLoadEstimator({
      windowMs: 10000,
      baselineEmaAlpha: 0.005, // Slow adaptation to maintain baseline contrast
    });
    let time = 1000;

    // Establish resting baseline at 3.0mm
    for (let i = 0; i < 30; i++) {
      time += 50;
      estimator.recordSample(time, 3.0);
    }

    // High cognitive load impulse (+0.4mm dilation)
    time += 50;
    const highRes = estimator.recordSample(time, 3.4);
    assert.ok(highRes.zScore >= 1.2);
    assert.ok(highRes.level === 'HIGH' || highRes.level === 'OVERLOAD');

    // Extreme cognitive overload impulse (+1.2mm dilation)
    time += 50;
    const overloadRes = estimator.recordSample(time, 4.2);
    assert.equal(overloadRes.level, 'OVERLOAD');
    assert.ok(overloadRes.zScore >= 2.2);
  });

  test('evicts stale samples outside sliding temporal window', () => {
    const estimator = new CognitiveLoadEstimator({ windowMs: 2000 });

    estimator.recordSample(1000, 3.5);
    estimator.recordSample(1500, 3.5);
    estimator.recordSample(2000, 3.5);
    assert.equal(estimator.history.length, 3);

    // Sample at 3500ms should evict sample at 1000ms (cutoff: 1500ms)
    estimator.recordSample(3500, 3.5);
    assert.equal(estimator.history.length, 3);
    assert.equal(estimator.history[0].timestampMs, 1500);
  });

  test('resets estimator telemetry and internal history cleanly', () => {
    const estimator = new CognitiveLoadEstimator();
    estimator.recordSample(1000, 3.5);
    assert.equal(estimator.getTelemetry().totalSamples, 1);

    estimator.reset();
    const clean = estimator.getTelemetry();
    assert.equal(clean.totalSamples, 0);
    assert.equal(clean.bufferedSampleCount, 0);
    assert.equal(estimator.isCalibrated, false);
  });
});
