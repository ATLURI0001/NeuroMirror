import test from 'node:test';
import assert from 'node:assert/strict';
import { BiometricKalman1D, BiometricKalman2D } from '../assets/js/biometric_kalman.js';

test('BiometricKalman1D initializes and tracks constant velocity trajectory', () => {
  const kf = new BiometricKalman1D({ processNoise: 1.0, measurementNoise: 0.05 });

  // Uninitialized frame with null measurement
  const pre = kf.update(null, 0.016);
  assert.equal(pre.status, 'UNINITIALIZED');

  // Seed at x=0
  const init = kf.update(0.0, 0.05);
  assert.equal(init.status, 'TRACKING');
  assert.equal(init.value, 0.0);

  // Feed constant velocity trajectory: x = 10 * t (v = 10 units/sec)
  const dt = 0.05; // 20 Hz
  let lastResult;
  for (let i = 1; i <= 30; i++) {
    const truePos = 10.0 * (i * dt);
    lastResult = kf.update(truePos, dt);
  }

  // Estimated velocity should have converged near 10
  assert.ok(lastResult.velocity > 7.0 && lastResult.velocity < 13.0);
  assert.ok(Math.abs(lastResult.value - 15.0) < 1.0);
});

test('BiometricKalman1D reduces sensor measurement noise', () => {
  const kf = new BiometricKalman1D({ processNoise: 0.001, measurementNoise: 0.5 });
  kf.update(50.0, 0.016);

  // Feed noisy measurements oscillating around 50 (+- 0.5)
  const outputs = [];
  for (let i = 0; i < 40; i++) {
    const noise = (i % 2 === 0 ? 0.5 : -0.5);
    const res = kf.update(50.0 + noise, 0.016);
    outputs.push(res.value);
  }

  // Filtered values should remain tightly bound around 50 (within 0.1)
  const last = outputs[outputs.length - 1];
  assert.ok(Math.abs(last - 50.0) < 0.15);
});

test('BiometricKalman1D coasts during sensor dropouts and handles prolonged loss', () => {
  const kf = new BiometricKalman1D({ maxCoastFrames: 5 });
  kf.update(100.0, 0.016);
  // Feed sequential updates with positive velocity
  kf.update(101.0, 0.016);
  kf.update(102.0, 0.016);
  kf.update(103.0, 0.016);

  // Drop measurement (e.g. eye blink)
  const coast1 = kf.update(null, 0.016);
  assert.equal(coast1.isCoasting, true);
  assert.equal(coast1.status, 'COASTING');
  assert.ok(coast1.value > 102.0); // Kinematic projection forward

  // Exceed maxCoastFrames (5 frames)
  for (let i = 0; i < 6; i++) {
    kf.update(null, 0.016);
  }
  const lost = kf.update(null, 0.016);
  assert.equal(lost.status, 'LOST');
});

test('BiometricKalman1D rejects anomalous spikes via Mahalanobis gate', () => {
  const kf = new BiometricKalman1D({ outlierThreshold: 3.0 });
  // Establish steady position around 10.0
  for (let i = 0; i < 15; i++) {
    kf.update(10.0, 0.016);
  }

  // Sudden outlier spike (sensor glitch to 200.0)
  const anomaly = kf.update(200.0, 0.016);
  assert.equal(anomaly.isOutlier, true);
  assert.equal(anomaly.status, 'OUTLIER_COASTING');
  // State should NOT have jumped to 200
  assert.ok(anomaly.value < 15.0);
});

test('BiometricKalman2D coordinates tracking on dual orthogonal axes', () => {
  const kf2d = new BiometricKalman2D();
  kf2d.reset(100, 200);

  const res = kf2d.update(101, 202, 0.05);
  assert.ok(res.x > 99 && res.x < 103);
  assert.ok(res.y > 199 && res.y < 204);
  assert.equal(res.isCoasting, false);
  assert.equal(res.status, 'TRACKING');
});
