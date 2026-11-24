import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GazeRaycastSentinel,
  RaycastStatus,
} from '../assets/js/gaze_raycast_sentinel.js';

describe('GazeRaycastSentinel Core Suite', () => {
  it('initializes with default options and clean metrics', () => {
    const sentinel = new GazeRaycastSentinel();
    assert.equal(sentinel.screenWidth, 1920);
    assert.equal(sentinel.screenHeight, 1080);
    assert.equal(sentinel.minConfidence, 0.30);
    const metrics = sentinel.getMetrics();
    assert.equal(metrics.totalRaycastsEvaluated, 0);
    assert.equal(metrics.nanIncidentsBlocked, 0);
  });

  it('projects nominal forward ray cleanly onto display plane', () => {
    const sentinel = new GazeRaycastSentinel();
    // Eye at (0, 0, 0), looking straight forward along +Z axis towards plane at 600mm
    const origin = [0, 0, 0];
    const direction = [0, 0, 1];

    const res = sentinel.sanitizeRaycast(origin, direction, 0.95, 1000);
    assert.equal(res.valid, true);
    assert.equal(res.fallbackUsed, false);
    assert.equal(res.status, RaycastStatus.VALID);
    // Looking straight at center of screen
    assert.equal(res.x, 960);
    assert.equal(res.y, 540);
  });

  it('intercepts NaN and Infinity coordinates and applies center fallback', () => {
    const sentinel = new GazeRaycastSentinel();

    // NaN origin
    const badRes1 = sentinel.sanitizeRaycast([NaN, 0, 0], [0, 0, 1], 1.0, 1000);
    assert.equal(badRes1.valid, false);
    assert.equal(badRes1.fallbackUsed, true);
    assert.equal(badRes1.status, RaycastStatus.NAN_COORDINATE_INTERCEPTED);
    assert.equal(badRes1.x, 960);
    assert.equal(badRes1.y, 540);

    // Infinite direction
    const badRes2 = sentinel.sanitizeRaycast([0, 0, 0], [Infinity, 0, 1], 1.0, 1001);
    assert.equal(badRes2.valid, false);
    assert.equal(badRes2.status, RaycastStatus.NAN_COORDINATE_INTERCEPTED);

    const metrics = sentinel.getMetrics();
    assert.equal(metrics.nanIncidentsBlocked, 2);
  });

  it('intercepts zero magnitude vectors and backward rays', () => {
    const sentinel = new GazeRaycastSentinel();

    // Zero vector
    const zeroRes = sentinel.sanitizeRaycast([0, 0, 0], [0, 0, 0], 1.0, 1000);
    assert.equal(zeroRes.status, RaycastStatus.NAN_COORDINATE_INTERCEPTED);

    // Backward vector (dz < 0)
    const backRes = sentinel.sanitizeRaycast([0, 0, 0], [0, 0, -1], 1.0, 1002);
    assert.equal(backRes.status, RaycastStatus.BACKWARD_RAY_INTERCEPTED);
    assert.equal(sentinel.getMetrics().backwardRaysBlocked, 1);
  });

  it('intercepts grazing parallel rays (dz ~ 0)', () => {
    const sentinel = new GazeRaycastSentinel();

    // Ray shooting parallel to screen surface
    const parallelRes = sentinel.sanitizeRaycast([0, 0, 0], [1, 0, 0.00001], 1.0, 1000);
    assert.equal(parallelRes.status, RaycastStatus.PARALLEL_RAY_INTERCEPTED);
    assert.equal(sentinel.getMetrics().parallelRaysBlocked, 1);
  });

  it('coasts on last valid point during brief sensor dropouts', () => {
    const sentinel = new GazeRaycastSentinel({ holdLastKnownMs: 300 });

    // 1. Establish valid point at t=1000
    // Looking slightly right: dx = 0.1, dz = 1.0
    const valid = sentinel.sanitizeRaycast([0, 0, 0], [0.1, 0, 1.0], 1.0, 1000);
    assert.equal(valid.valid, true);
    const validX = valid.x;
    const validY = valid.y;

    // 2. Glare dropout at t=1150 (150ms later < 300ms hold window)
    const dropout = sentinel.sanitizeRaycast([NaN, NaN, NaN], [0, 0, 1], 1.0, 1150);
    assert.equal(dropout.valid, false);
    assert.equal(dropout.fallbackUsed, true);
    assert.equal(dropout.fallbackType, 'COAST_LAST_VALID');
    assert.equal(dropout.x, validX);
    assert.equal(dropout.y, validY);

    // 3. Prolonged dropout at t=1500 (500ms later > 300ms hold window)
    const expired = sentinel.sanitizeRaycast([NaN, NaN, NaN], [0, 0, 1], 1.0, 1500);
    assert.equal(expired.fallbackType, 'DEFAULT_CENTER_ANCHOR');
    assert.equal(expired.x, 960);
    assert.equal(expired.y, 540);
  });

  it('gates low-confidence tracking frames', () => {
    const sentinel = new GazeRaycastSentinel({ minConfidence: 0.50 });

    const lowConf = sentinel.sanitizeRaycast([0, 0, 0], [0, 0, 1], 0.25, 1000);
    assert.equal(lowConf.status, RaycastStatus.CONFIDENCE_TOO_LOW);
    assert.equal(sentinel.getMetrics().lowConfidenceDropped, 1);
  });

  it('generates informative incident postmortem markdown report', () => {
    const sentinel = new GazeRaycastSentinel();
    assert.match(sentinel.generatePostmortemReport(), /No Raycast Anomalies Detected/);

    sentinel.sanitizeRaycast([NaN, 0, 0], [0, 0, 1], 1.0, 1000);
    sentinel.sanitizeRaycast([0, 0, 0], [0, 0, -1], 1.0, 1001);

    const report = sentinel.generatePostmortemReport();
    assert.match(report, /Incident Postmortem: Eye-Tracking Gaze Raycasting NaN/);
    assert.match(report, /NON_FINITE_COORDINATE/);
    assert.match(report, /BACKWARD_RAY/);
    assert.equal(sentinel.getIncidents().length, 2);

    sentinel.reset();
    assert.equal(sentinel.getMetrics().totalRaycastsEvaluated, 0);
    assert.equal(sentinel.getIncidents().length, 0);
  });
});
