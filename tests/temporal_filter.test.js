import test from "node:test";
import assert from "node:assert/strict";

import {
  LandmarkKalmanFilter3D,
  TrackingState,
  normalizeQuaternion,
  quaternionToEuler,
  sanitizeDeltaTime,
} from "../assets/js/temporal_filter_contract.js";

test("sanitizeDeltaTime enforces monotonicity and clamps boundary intervals", () => {
  // Default on null previous
  assert.equal(sanitizeDeltaTime(null, 1.0), 1.0 / 60.0);

  // Normal 16.6ms delta
  const dt = sanitizeDeltaTime(1.0, 1.0166);
  assert.ok(Math.abs(dt - 0.0166) < 1e-4);

  // Non-monotonic error
  assert.throws(() => sanitizeDeltaTime(1.05, 1.0), /Non-monotonic timestamp/);
  assert.throws(() => sanitizeDeltaTime(1.0, 1.0), /Non-monotonic timestamp/);

  // Non-finite check
  assert.throws(() => sanitizeDeltaTime(1.0, NaN), /must be a finite number/);

  // Clamping: very large interval clamped to 0.5s
  assert.equal(sanitizeDeltaTime(1.0, 5.0), 0.5);

  // Clamping: micro-interval clamped to 0.001s
  assert.equal(sanitizeDeltaTime(1.0, 1.000001), 0.001);
});

test("normalizeQuaternion produces unit length and guards against non-finite values", () => {
  const q = normalizeQuaternion([1, 1, 1, 1]);
  const norm = Math.sqrt(q[0] ** 2 + q[1] ** 2 + q[2] ** 2 + q[3] ** 2);
  assert.ok(Math.abs(norm - 1.0) < 1e-9);

  // Degenerate zero quaternion returns identity [0, 0, 0, 1]
  assert.deepEqual(normalizeQuaternion([0, 0, 0, 0]), [0, 0, 0, 1]);

  // Invalid length or non-finite
  assert.throws(() => normalizeQuaternion([1, 2, 3]), /must be an array of 4 numbers/);
  assert.throws(() => normalizeQuaternion([1, NaN, 0, 0]), /not a finite number/);
});

test("quaternionToEuler calculates Euler angles correctly", () => {
  // Identity quaternion -> 0, 0, 0
  const euler = quaternionToEuler([0, 0, 0, 1]);
  assert.equal(euler.pitch, 0);
  assert.equal(euler.yaw, 0);
  assert.equal(euler.roll, 0);
});

test("LandmarkKalmanFilter3D tracks kinematics and estimates velocity", () => {
  const kf = new LandmarkKalmanFilter3D();

  // Frame 1 at t=0s, pos=[0, 0, 0]
  const res1 = kf.update([0, 0, 0], 0.0);
  assert.equal(res1.status, TrackingState.TRACKING);
  assert.deepEqual(res1.velocity, [0, 0, 0]);

  // Moving along X axis at ~1.0 m/s: at t=0.1s pos=[0.1, 0, 0]
  kf.update([0.1, 0, 0], 0.1);
  const res3 = kf.update([0.2, 0, 0], 0.2);

  assert.equal(res3.status, TrackingState.TRACKING);
  assert.ok(res3.velocity[0] > 0.5, "Estimated X velocity should be positive");
});

test("LandmarkKalmanFilter3D rejects Mahalanobis outliers and enters coasting", () => {
  const kf = new LandmarkKalmanFilter3D({ maxCoastingFrames: 3 });

  // Initialize and establish stable track around [0, 0, 0]
  kf.update([0, 0, 0], 1.0);
  kf.update([0.01, 0, 0], 1.016);
  kf.update([0.02, 0, 0], 1.032);

  // Sudden catastrophic camera tracking glitch jumping to [100, 200, 300]
  const outlierRes = kf.update([100, 200, 300], 1.048);
  assert.equal(outlierRes.gatedOutlier, true);
  assert.equal(outlierRes.status, TrackingState.COASTING);

  // Position remains close to previous track, not corrupted by outlier
  assert.ok(Math.abs(outlierRes.position[0] - 0.02) < 1.0);

  // Exceeding max coasting frames transitions to LOST
  kf.update([100, 200, 300], 1.064);
  kf.update([100, 200, 300], 1.080);
  const lostRes = kf.update([100, 200, 300], 1.096);
  assert.equal(lostRes.status, TrackingState.LOST);
});
