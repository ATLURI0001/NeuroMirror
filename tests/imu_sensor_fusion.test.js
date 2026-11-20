import assert from "node:assert/strict";
import test from "node:test";
import {
  ComplementaryFilter6DOF,
  estimateTiltFromAccel,
  wrapAngle,
} from "../assets/js/imu_sensor_fusion.js";

test("wrapAngle keeps angles in [-PI, PI] and wraps multiples", () => {
  assert.equal(wrapAngle(0), 0);
  assert.equal(wrapAngle(Math.PI), Math.PI);
  assert.equal(wrapAngle(-Math.PI), -Math.PI);

  const wrappedOver = wrapAngle(3.0 * Math.PI);
  assert.ok(Math.abs(wrappedOver - Math.PI) < 1e-6 || Math.abs(wrappedOver + Math.PI) < 1e-6);

  const wrappedUnder = wrapAngle(-3.0 * Math.PI);
  assert.ok(Math.abs(wrappedUnder - Math.PI) < 1e-6 || Math.abs(wrappedUnder + Math.PI) < 1e-6);

  assert.throws(() => wrapAngle(NaN), TypeError);
  assert.throws(() => wrapAngle(Infinity), TypeError);
});

test("estimateTiltFromAccel accurately determines pitch and roll from gravity", () => {
  // Pure Z gravity (level upright)
  const upright = estimateTiltFromAccel(0, 0, 9.80665);
  assert.ok(Math.abs(upright.pitch) < 1e-5);
  assert.ok(Math.abs(upright.roll) < 1e-5);
  assert.ok(Math.abs(upright.magnitude - 9.80665) < 1e-5);

  // Pure Y acceleration (90 deg roll)
  const roll90 = estimateTiltFromAccel(0, 9.80665, 0);
  assert.ok(Math.abs(roll90.roll - Math.PI / 2.0) < 1e-5);
  assert.ok(Math.abs(roll90.pitch) < 1e-5);

  // Pure -X acceleration (90 deg pitch)
  const pitch90 = estimateTiltFromAccel(-9.80665, 0, 0);
  assert.ok(Math.abs(pitch90.pitch - Math.PI / 2.0) < 1e-5);
  assert.ok(Math.abs(pitch90.roll) < 1e-5);

  assert.throws(() => estimateTiltFromAccel("not-a-num", 0, 0), TypeError);
});

test("ComplementaryFilter6DOF calibrates gyroscope bias and converges to static tilt", () => {
  const filter = new ComplementaryFilter6DOF({ alpha: 0.90 });

  // Calibrate with stationary samples having constant 0.05 rad/s drift
  const stationarySamples = [
    [0.05, 0.02, -0.01],
    [0.05, 0.02, -0.01],
    [0.05, 0.02, -0.01],
  ];
  const bias = filter.calibrateBias(stationarySamples);
  assert.ok(Math.abs(bias[0] - 0.05) < 1e-6);
  assert.ok(Math.abs(bias[1] - 0.02) < 1e-6);
  assert.ok(Math.abs(bias[2] - (-0.01)) < 1e-6);

  // Feed upright static acceleration with 0 real angular velocity (raw gyro = bias)
  for (let i = 0; i < 50; i++) {
    filter.update([0, 0, 9.80665], [0.05, 0.02, -0.01], 0.02);
  }

  assert.ok(Math.abs(filter.pitch) < 1e-4);
  assert.ok(Math.abs(filter.roll) < 1e-4);
  assert.ok(Math.abs(filter.yaw) < 1e-4);
});

test("ComplementaryFilter6DOF rejects linear acceleration disturbances via G-force gate", () => {
  const filter = new ComplementaryFilter6DOF({ alpha: 0.95, gravityTolerance: 0.15 });

  // Baseline at level
  filter.update([0, 0, 9.80665], [0, 0, 0], 0.02);
  assert.ok(Math.abs(filter.pitch) < 1e-5);

  // Sudden high-g acceleration (e.g. 35 m/s^2 linear shock during rapid movement)
  const shocked = filter.update([25.0, 0, 25.0], [0, 0, 0], 0.02);

  // G-force gate must NOT trust accelerometer
  assert.equal(shocked.isAccelTrusted, false);
  // Pitch should not instantly jerk towards erroneous angle because accel is discarded
  assert.ok(Math.abs(filter.pitch) < 1e-4);
});

test("ComplementaryFilter6DOF accumulates yaw integration smoothly", () => {
  const filter = new ComplementaryFilter6DOF();
  // 1 rad/s yaw rate for 1 second (50 steps of 0.02s)
  for (let i = 0; i < 50; i++) {
    filter.update([0, 0, 9.80665], [0, 0, 1.0], 0.02);
  }
  // Yaw should be ~1.0 rad
  assert.ok(Math.abs(filter.yaw - 1.0) < 1e-3);
});

test("ComplementaryFilter6DOF validates input constraints", () => {
  const filter = new ComplementaryFilter6DOF();

  assert.throws(() => filter.update([0, 0], [0, 0, 0], 0.01), TypeError);
  assert.throws(() => filter.update([0, 0, 0], [0, 0], 0.01), TypeError);
  assert.throws(() => filter.update([0, 0, 0], [0, 0, 0], -0.01), RangeError);
  assert.throws(() => new ComplementaryFilter6DOF({ alpha: 1.5 }), RangeError);
});
