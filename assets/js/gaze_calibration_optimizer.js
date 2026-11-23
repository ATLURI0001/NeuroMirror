/**
 * @file gaze_calibration_optimizer.js
 * 2D Polynomial Gaze Calibration Engine & Spatial Accuracy Benchmark Profiler.
 * Computes regularized least-squares mapping from pupil space to screen coordinates
 * and evaluates spatial accuracy (RMSE degrees) and precision.
 */

/**
 * Solves a small symmetric linear system (A^T * A + lambda * I) * x = A^T * b using Gaussian elimination with partial pivoting.
 * @param {number[][]} M - (n x n) coefficient matrix
 * @param {number[]} rhs - (n) right-hand side vector
 * @returns {number[]} Solution vector x
 */
export function solveLinearSystem(M, rhs) {
  const n = rhs.length;
  // Clone to avoid mutating inputs
  const A = M.map(row => [...row]);
  const b = [...rhs];

  for (let i = 0; i < n; i++) {
    // Pivot selection
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) {
        maxRow = k;
      }
    }

    // Swap rows
    const tempRow = A[i];
    A[i] = A[maxRow];
    A[maxRow] = tempRow;

    const tempB = b[i];
    b[i] = b[maxRow];
    b[maxRow] = tempB;

    if (Math.abs(A[i][i]) < 1e-12) {
      throw new Error('Singular or degenerate matrix in calibration solver');
    }

    // Eliminate below
    for (let k = i + 1; k < n; k++) {
      const factor = A[k][i] / A[i][i];
      for (let j = i; j < n; j++) {
        A[k][j] -= factor * A[i][j];
      }
      b[k] -= factor * b[i];
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i];
    for (let j = i + 1; j < n; j++) {
      sum -= A[i][j] * x[j];
    }
    x[i] = sum / A[i][i];
  }

  return x;
}

export class GazeCalibrationOptimizer {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.pixelsPerDegree=35.0] - Display scale mapping pixels to visual angle.
   * @param {number} [options.ridgeLambda=1e-4] - L2 regularization penalty to prevent overfitting.
   */
  constructor(options = {}) {
    this.pixelsPerDegree = Number(options.pixelsPerDegree) || 35.0;
    this.ridgeLambda = Number(options.ridgeLambda) || 1e-4;

    this.calibrationPoints = [];
    this.coeffX = null; // [a0, a1, a2, a3, a4, a5]
    this.coeffY = null; // [b0, b1, b2, b3, b4, b5]
    this.isCalibrated = false;
  }

  /**
   * Constructs the 2nd-order polynomial feature vector for pupil coords (u, v):
   * phi(u, v) = [1, u, v, u^2, v^2, u*v]
   */
  static extractFeatures(u, v) {
    return [1.0, u, v, u * u, v * v, u * v];
  }

  /**
   * Adds a calibration target observation.
   */
  addCalibrationPoint(pupilU, pupilV, targetX, targetY) {
    if (!Number.isFinite(pupilU) || !Number.isFinite(pupilV) ||
        !Number.isFinite(targetX) || !Number.isFinite(targetY)) {
      throw new TypeError('Calibration coordinates must be finite numbers');
    }

    this.calibrationPoints.push({
      u: pupilU,
      v: pupilV,
      x: targetX,
      y: targetY,
    });
  }

  /**
   * Fits 2nd-order polynomial mapping using regularized least squares.
   */
  calibrate() {
    if (this.calibrationPoints.length < 6) {
      throw new Error(`Insufficient calibration points: got ${this.calibrationPoints.length}, required at least 6`);
    }

    const nFeatures = 6;
    // Compute Normal Equations: (Phi^T * Phi + lambda * I) * W = Phi^T * Y
    const ATA = Array.from({ length: nFeatures }, () => new Array(nFeatures).fill(0));
    const ATX = new Array(nFeatures).fill(0);
    const ATY = new Array(nFeatures).fill(0);

    for (const pt of this.calibrationPoints) {
      const phi = GazeCalibrationOptimizer.extractFeatures(pt.u, pt.v);
      for (let i = 0; i < nFeatures; i++) {
        for (let j = 0; j < nFeatures; j++) {
          ATA[i][j] += phi[i] * phi[j];
        }
        ATX[i] += phi[i] * pt.x;
        ATY[i] += phi[i] * pt.y;
      }
    }

    // Add Ridge Regularization (lambda * I)
    for (let i = 0; i < nFeatures; i++) {
      ATA[i][i] += this.ridgeLambda;
    }

    this.coeffX = solveLinearSystem(ATA, ATX);
    this.coeffY = solveLinearSystem(ATA, ATY);
    this.isCalibrated = true;

    return {
      coeffX: [...this.coeffX],
      coeffY: [...this.coeffY],
      pointsCount: this.calibrationPoints.length,
    };
  }

  /**
   * Maps raw pupil coordinate (u, v) to predicted screen gaze coordinates (x, y).
   */
  mapGaze(pupilU, pupilV) {
    if (!this.isCalibrated || !this.coeffX || !this.coeffY) {
      throw new Error('GazeCalibrationOptimizer is not calibrated yet');
    }
    if (!Number.isFinite(pupilU) || !Number.isFinite(pupilV)) {
      return { x: 0, y: 0, valid: false };
    }

    const phi = GazeCalibrationOptimizer.extractFeatures(pupilU, pupilV);
    let predX = 0;
    let predY = 0;

    for (let i = 0; i < 6; i++) {
      predX += this.coeffX[i] * phi[i];
      predY += this.coeffY[i] * phi[i];
    }

    return {
      x: Number(predX.toFixed(2)),
      y: Number(predY.toFixed(2)),
      valid: true,
    };
  }

  /**
   * Evaluates spatial accuracy across calibration or validation targets.
   */
  evaluateAccuracy(testPoints = null) {
    const points = testPoints || this.calibrationPoints;
    if (points.length === 0 || !this.isCalibrated) {
      return { rmsePixels: 0, rmseDegrees: 0, maxErrorPixels: 0, rating: 'UNRATED', count: 0 };
    }

    let sumSquaredError = 0;
    let maxErrorPixels = 0;
    const residuals = [];

    for (const pt of points) {
      const pred = this.mapGaze(pt.u, pt.v);
      const dx = pred.x - pt.x;
      const dy = pred.y - pt.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      residuals.push(dist);
      sumSquaredError += dist * dist;
      if (dist > maxErrorPixels) {
        maxErrorPixels = dist;
      }
    }

    const rmsePixels = Math.sqrt(sumSquaredError / points.length);
    const rmseDegrees = rmsePixels / this.pixelsPerDegree;

    let rating = 'POOR';
    if (rmseDegrees < 0.5) {
      rating = 'EXCELLENT';
    } else if (rmseDegrees < 1.0) {
      rating = 'GOOD';
    } else if (rmseDegrees < 1.5) {
      rating = 'FAIR';
    }

    return {
      rmsePixels: Number(rmsePixels.toFixed(2)),
      rmseDegrees: Number(rmseDegrees.toFixed(3)),
      maxErrorPixels: Number(maxErrorPixels.toFixed(2)),
      rating,
      count: points.length,
      residuals: residuals.map(r => Number(r.toFixed(2))),
    };
  }

  /**
   * Generates a GitHub Flavored Markdown benchmark report.
   */
  generateBenchmarkReport() {
    const acc = this.evaluateAccuracy();
    return [
      '| Calibration Target | True Target (px) | Pupil Space (u,v) | Predicted (px) | Spatial Residual |',
      '|:---|:---:|:---:|:---:|:---:|',
      ...this.calibrationPoints.map((pt, i) => {
        const pred = this.mapGaze(pt.u, pt.v);
        const err = acc.residuals[i] || 0;
        return `| **Point ${i + 1}** | (${pt.x}, ${pt.y}) | (${pt.u}, ${pt.v}) | (${pred.x}, ${pred.y}) | **${err} px (${(err / this.pixelsPerDegree).toFixed(2)}°)** |`;
      }),
      '| **Global Accuracy** | - | - | - | **RMSE: ' + acc.rmsePixels + ' px (' + acc.rmseDegrees + '°) [' + acc.rating + ']** |',
    ].join('\n');
  }

  reset() {
    this.calibrationPoints = [];
    this.coeffX = null;
    this.coeffY = null;
    this.isCalibrated = false;
  }
}
