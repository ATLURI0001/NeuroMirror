const test = require('node:test');
const assert = require('node:assert/strict');
const { HeadPoseCircuitBreaker, CircuitState } = require('../assets/js/head_pose_circuit_breaker.js');

test('HeadPoseCircuitBreaker - normal pose passes and applies EMA smoothing', () => {
  const cb = new HeadPoseCircuitBreaker({ smoothingFactor: 0.5 });
  const t0 = 1000;

  const res1 = cb.processPose({ pitch: 10, yaw: 20, roll: 0 }, t0);
  assert.equal(res1.state, CircuitState.CLOSED);
  assert.equal(res1.fallbackApplied, false);
  // initial smoothing from 0 with alpha=0.5 -> 5, 10, 0
  assert.equal(res1.pose.pitch, 5);
  assert.equal(res1.pose.yaw, 10);
});

test('HeadPoseCircuitBreaker - trips on NaN and non-finite values', () => {
  const cb = new HeadPoseCircuitBreaker({ failureThreshold: 2 });
  const t0 = 1000;

  const res1 = cb.processPose({ pitch: NaN, yaw: 0, roll: 0 }, t0);
  assert.equal(res1.fallbackApplied, true);
  assert.equal(res1.reason, 'ERR_NON_FINITE_ANGULAR_VALUES');
  assert.equal(res1.state, CircuitState.CLOSED); // 1 failure < 2

  const res2 = cb.processPose({ pitch: Infinity, yaw: 0, roll: 0 }, t0 + 16);
  assert.equal(res2.fallbackApplied, true);
  assert.equal(res2.state, CircuitState.OPEN); // 2 failures >= 2
});

test('HeadPoseCircuitBreaker - catches gimbal lock singularity', () => {
  const cb = new HeadPoseCircuitBreaker({ pitchSingularityThreshold: 85.0, failureThreshold: 1 });
  const t0 = 1000;

  const res = cb.processPose({ pitch: 88.5, yaw: 10, roll: 5 }, t0);
  assert.equal(res.state, CircuitState.OPEN);
  assert.equal(res.fallbackApplied, true);
  assert.equal(res.reason, 'ERR_GIMBAL_LOCK_SINGULARITY');
});

test('HeadPoseCircuitBreaker - detects excessive angular velocity jitter', () => {
  const cb = new HeadPoseCircuitBreaker({ maxAngularVelocityDegPerSec: 500, failureThreshold: 1 });
  const t0 = 1000;

  cb.processPose({ pitch: 0, yaw: 0, roll: 0 }, t0);
  // 30 degrees in 10ms = 3000 deg/sec > 500
  const res = cb.processPose({ pitch: 30, yaw: 0, roll: 0 }, t0 + 10);

  assert.equal(res.state, CircuitState.OPEN);
  assert.equal(res.fallbackApplied, true);
  assert.equal(res.reason, 'ERR_ANGULAR_VELOCITY_JITTER');
});

test('HeadPoseCircuitBreaker - transitions OPEN -> HALF_OPEN -> CLOSED upon recovery', () => {
  const cb = new HeadPoseCircuitBreaker({
    failureThreshold: 1,
    recoverySuccessThreshold: 2,
    cooldownPeriodMs: 500,
  });

  const t0 = 1000;
  // Trip circuit
  cb.processPose({ pitch: 89, yaw: 0, roll: 0 }, t0);
  assert.equal(cb.state, CircuitState.OPEN);

  // Still OPEN before cooldown
  const res1 = cb.processPose({ pitch: 5, yaw: 0, roll: 0 }, t0 + 200);
  assert.equal(res1.state, CircuitState.OPEN);
  assert.equal(res1.fallbackApplied, true);

  // Enters HALF_OPEN after cooldown (t0 + 600)
  const res2 = cb.processPose({ pitch: 5, yaw: 0, roll: 0 }, t0 + 600);
  assert.equal(res2.state, CircuitState.HALF_OPEN);
  assert.equal(res2.fallbackApplied, false);

  // Second stable frame -> CLOSED
  const res3 = cb.processPose({ pitch: 5, yaw: 0, roll: 0 }, t0 + 620);
  assert.equal(res3.state, CircuitState.CLOSED);
  assert.equal(res3.fallbackApplied, false);
});
