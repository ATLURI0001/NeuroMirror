import test from "node:test";
import assert from "node:assert/strict";
import {
  computeRigidTransform,
  det3x3,
  LandmarkValidationError,
  OneEuroFilter3D,
  validateAndSanitizeLandmarks,
} from "../assets/js/landmark_alignment_engine.js";

test("validateAndSanitizeLandmarks rejects empty and small arrays", () => {
  assert.throws(() => validateAndSanitizeLandmarks([]), LandmarkValidationError);
  assert.throws(() => validateAndSanitizeLandmarks([{ x: 0, y: 0 }]), LandmarkValidationError);
});

test("validateAndSanitizeLandmarks rejects non-finite coordinates", () => {
  assert.throws(
    () =>
      validateAndSanitizeLandmarks([
        { x: 0, y: 0, z: 0 },
        { x: 1, y: NaN, z: 0 },
        { x: 2, y: 2, z: 2 },
      ]),
    LandmarkValidationError
  );
});

test("validateAndSanitizeLandmarks rejects zero-variance points", () => {
  assert.throws(
    () =>
      validateAndSanitizeLandmarks([
        { x: 5, y: 5, z: 5 },
        { x: 5, y: 5, z: 5 },
        { x: 5, y: 5, z: 5 },
      ]),
    LandmarkValidationError
  );
});

test("computeRigidTransform recovers pure translation", () => {
  const source = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
  ];
  const target = source.map((p) => ({ x: p.x + 10, y: p.y - 5, z: p.z + 2.5 }));

  const transform = computeRigidTransform(source, target);
  assert.ok(transform.rmse < 1e-5, `RMSE too high: ${transform.rmse}`);
  assert.ok(Math.abs(transform.translation.x - 10) < 1e-4);
  assert.ok(Math.abs(transform.translation.y - (-5)) < 1e-4);
  assert.ok(Math.abs(transform.translation.z - 2.5) < 1e-4);

  // Rotation should be identity matrix
  const R = transform.rotation;
  assert.ok(Math.abs(R[0][0] - 1) < 1e-4);
  assert.ok(Math.abs(R[1][1] - 1) < 1e-4);
  assert.ok(Math.abs(R[2][2] - 1) < 1e-4);
  assert.ok(Math.abs(det3x3(R) - 1.0) < 1e-4);
});

test("computeRigidTransform recovers 90-degree Z-axis rotation", () => {
  const source = [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: -1, z: 0 },
  ];
  // 90 deg around Z: (x, y) -> (-y, x)
  const target = source.map((p) => ({ x: -p.y, y: p.x, z: p.z }));

  const transform = computeRigidTransform(source, target);
  assert.ok(transform.rmse < 1e-5, `RMSE too high: ${transform.rmse}`);
  assert.ok(Math.abs(det3x3(transform.rotation) - 1.0) < 1e-4);
});

test("computeRigidTransform recovers uniform scale", () => {
  const source = [
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 2, z: 0 },
  ];
  const target = source.map((p) => ({ x: p.x * 3, y: p.y * 3, z: p.z * 3 }));

  const transform = computeRigidTransform(source, target, true);
  assert.ok(transform.rmse < 1e-5, `RMSE too high: ${transform.rmse}`);
  assert.ok(Math.abs(transform.scale - 3.0) < 1e-4);
});

test("OneEuroFilter3D filters stationary noise while tracking fast movement", () => {
  const filter = new OneEuroFilter3D({ minCutoff: 1.0, beta: 0.007 });

  // Feed noisy stationary signal
  const t0 = 0.0;
  filter.filter({ x: 10.0, y: 20.0, z: 5.0 }, t0);
  const smoothed = filter.filter({ x: 10.5, y: 19.8, z: 5.1 }, t0 + 0.033);

  // Filter should attenuate the 0.5 jitter jump
  assert.ok(Math.abs(smoothed.x - 10.5) > 0.1);

  // Fast movement
  const fast = filter.filter({ x: 50.0, y: 60.0, z: 30.0 }, t0 + 0.066);
  assert.ok(fast.x > 25.0, "Filter should respond quickly to genuine high-speed displacement");
});
