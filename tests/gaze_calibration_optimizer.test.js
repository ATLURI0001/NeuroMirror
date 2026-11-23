import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GazeCalibrationOptimizer,
  solveLinearSystem,
} from '../assets/js/gaze_calibration_optimizer.js';

test('solveLinearSystem: solves small linear systems accurately', () => {
  // 2x + y = 5
  // x + 3y = 10
  // Solution: x = 1, y = 3
  const M = [
    [2, 1],
    [1, 3],
  ];
  const b = [5, 10];
  const sol = solveLinearSystem(M, b);
  assert.equal(Math.round(sol[0]), 1);
  assert.equal(Math.round(sol[1]), 3);

  // Singular matrix
  const singular = [
    [1, 2],
    [2, 4],
  ];
  assert.throws(() => solveLinearSystem(singular, [1, 2]), /Singular/);
});

test('GazeCalibrationOptimizer: fits 9-point calibration grid and achieves EXCELLENT accuracy', () => {
  const optimizer = new GazeCalibrationOptimizer({
    pixelsPerDegree: 35.0,
    ridgeLambda: 1e-6,
  });

  // Synthetic ground truth: X = 100 + 800u + 50u^2, Y = 50 + 600v + 20uv
  const uVals = [0.1, 0.5, 0.9];
  const vVals = [0.1, 0.5, 0.9];

  for (const u of uVals) {
    for (const v of vVals) {
      const trueX = 100 + 800 * u + 50 * u * u;
      const trueY = 50 + 600 * v + 20 * u * v;
      optimizer.addCalibrationPoint(u, v, trueX, trueY);
    }
  }

  const calib = optimizer.calibrate();
  assert.equal(calib.pointsCount, 9);
  assert.equal(optimizer.isCalibrated, true);

  // Evaluate accuracy
  const acc = optimizer.evaluateAccuracy();
  assert.equal(acc.count, 9);
  assert.ok(acc.rmsePixels < 1.0, `Expected RMSE < 1.0px, got ${acc.rmsePixels}`);
  assert.ok(acc.rmseDegrees < 0.1, `Expected RMSE < 0.1 deg, got ${acc.rmseDegrees}`);
  assert.equal(acc.rating, 'EXCELLENT');

  // Verify prediction on arbitrary internal point (0.3, 0.7)
  const pred = optimizer.mapGaze(0.3, 0.7);
  const expectedX = 100 + 800 * 0.3 + 50 * 0.3 * 0.3; // 344.5
  const expectedY = 50 + 600 * 0.7 + 20 * 0.3 * 0.7; // 474.2
  assert.ok(Math.abs(pred.x - expectedX) < 1.0);
  assert.ok(Math.abs(pred.y - expectedY) < 1.0);
});

test('GazeCalibrationOptimizer: throws when calibrated with fewer than 6 points', () => {
  const optimizer = new GazeCalibrationOptimizer();
  optimizer.addCalibrationPoint(0.1, 0.1, 100, 100);
  optimizer.addCalibrationPoint(0.2, 0.2, 200, 200);

  assert.throws(() => optimizer.calibrate(), /Insufficient calibration points/);
  assert.throws(() => optimizer.mapGaze(0.1, 0.1), /not calibrated yet/);
});

test('GazeCalibrationOptimizer: handles invalid coordinates and generates markdown report', () => {
  const optimizer = new GazeCalibrationOptimizer();

  assert.throws(() => optimizer.addCalibrationPoint(NaN, 0.5, 100, 100), TypeError);
  assert.throws(() => optimizer.addCalibrationPoint(0.5, Infinity, 100, 100), TypeError);

  // 6 points to allow minimal calibration
  for (let i = 0; i < 6; i++) {
    optimizer.addCalibrationPoint(i * 0.1, i * 0.1, i * 100, i * 100);
  }
  optimizer.calibrate();

  // Invalid map coords return valid: false
  const invalidPred = optimizer.mapGaze(NaN, 0.5);
  assert.equal(invalidPred.valid, false);

  const report = optimizer.generateBenchmarkReport();
  assert.ok(report.includes('| Calibration Target |'));
  assert.ok(report.includes('Point 1'));
  assert.ok(report.includes('Global Accuracy'));

  optimizer.reset();
  assert.equal(optimizer.isCalibrated, false);
});
