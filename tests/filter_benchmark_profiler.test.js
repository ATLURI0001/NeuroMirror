import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ExponentialSmoothingFilter,
  OneEuroSmoothingFilter,
  KalmanKinematicFilter,
  FilterBenchmarkProfiler,
} from '../assets/js/filter_benchmark_profiler.js';

describe('FilterBenchmarkProfiler Suite', () => {
  it('smooths noisy coordinates using ExponentialMovingAverage', () => {
    const ema = new ExponentialSmoothingFilter(0.5);
    assert.equal(ema.update(10), 10);
    assert.equal(ema.update(20), 15);
    assert.equal(ema.update(20), 17.5);
  });

  it('smooths coordinates using OneEuroFilter with velocity adaptation', () => {
    const euro = new OneEuroSmoothingFilter(1.0, 0.007);
    const p1 = euro.update(100, 1000);
    assert.equal(p1, 100);

    const p2 = euro.update(102, 1008);
    // Should smoothly track small movement
    assert.ok(p2 > 100 && p2 < 102);
  });

  it('estimates velocity and filters noise using KalmanKinematicFilter', () => {
    const kf = new KalmanKinematicFilter(0.1, 0.5);
    const p1 = kf.update(50, 1000);
    assert.equal(p1, 50);

    const p2 = kf.update(52, 1010);
    assert.ok(p2 > 50 && p2 < 52);
    assert.ok(kf.vel > 0);
  });

  it('generates synthetic trajectory with expected sample count and properties', () => {
    const traj = FilterBenchmarkProfiler.generateTrajectory(500, 120);
    assert.equal(traj.length, 500);
    assert.ok(traj[0].timestamp === 0);
    assert.ok(traj[1].timestamp > 0);
    assert.ok(Number.isFinite(traj[0].measurement));
  });

  it('runs comparative benchmark suite and produces valid markdown report', () => {
    const { results, report } = FilterBenchmarkProfiler.runComparativeSuite(1000, 120);
    assert.equal(results.length, 3);

    for (const r of results) {
      assert.ok(r.opsPerSec > 0);
      assert.ok(r.meanLatencyUs >= 0);
      assert.ok(r.p50LatencyUs >= 0);
      assert.ok(r.p90LatencyUs >= 0);
      assert.ok(r.p99LatencyUs >= 0);
      assert.ok(r.rmse > 0);
      assert.ok(r.noiseReductionPct >= 0);
    }

    assert.ok(report.includes('# Gaze Coordinate Smoothing & Filter Benchmark Profiler'));
    assert.ok(report.includes('| **ExponentialMovingAverage** |'));
    assert.ok(report.includes('| **OneEuroFilter** |'));
    assert.ok(report.includes('| **KalmanKinematicFilter** |'));
  });
});
