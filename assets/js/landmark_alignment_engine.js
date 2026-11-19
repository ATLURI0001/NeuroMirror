/**
 * Kabsch-Umeyama Rigid Landmark Alignment & One-Euro Filter (NeuroMirror)
 * 
 * Provides:
 * - Landmark array sanitization & contract validation (finite numbers, variance threshold).
 * - Exact 3x3 Kabsch-Umeyama algorithm with reflection correction (det(R) = +1 in SO(3)).
 * - Scale, rotation matrix, translation vector, and alignment RMSE computation.
 * - OneEuroFilter3D for low-latency jitter suppression in real-time AR pipelines.
 */

export class LandmarkValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "LandmarkValidationError";
    this.details = details;
  }
}

/**
 * Validates and sanitizes 3D landmark points.
 * Ensures points are non-empty, finite, and exhibit sufficient 3D variance.
 */
export function validateAndSanitizeLandmarks(points, minCount = 3) {
  if (!Array.isArray(points) || points.length < minCount) {
    throw new LandmarkValidationError(`Expected at least ${minCount} points, received ${points?.length}`);
  }

  const sanitized = [];
  let sumX = 0, sumY = 0, sumZ = 0;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (!pt || typeof pt !== "object") {
      throw new LandmarkValidationError(`Point at index ${i} is not an object`);
    }

    const x = Number(pt.x);
    const y = Number(pt.y);
    const z = Number(pt.z ?? 0);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new LandmarkValidationError(`Non-finite coordinate detected at index ${i}`, { index: i, point: pt });
    }

    sanitized.push({ x, y, z });
    sumX += x;
    sumY += y;
    sumZ += z;
  }

  const n = sanitized.length;
  const centroid = { x: sumX / n, y: sumY / n, z: sumZ / n };

  // Compute variance from centroid
  let variance = 0;
  for (const pt of sanitized) {
    const dx = pt.x - centroid.x;
    const dy = pt.y - centroid.y;
    const dz = pt.z - centroid.z;
    variance += dx * dx + dy * dy + dz * dz;
  }
  variance /= n;

  if (variance < 1e-7) {
    throw new LandmarkValidationError("Degenerate landmark geometry: points have near-zero spatial variance", { variance });
  }

  return { points: sanitized, centroid, variance };
}

/**
 * Multiplies two 3x3 matrices: A * B.
 */
function matMul3x3(A, B) {
  const C = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
    }
  }
  return C;
}

/**
 * Transposes a 3x3 matrix.
 */
function transpose3x3(M) {
  return [
    [M[0][0], M[1][0], M[2][0]],
    [M[0][1], M[1][1], M[2][1]],
    [M[0][2], M[1][2], M[2][2]],
  ];
}

/**
 * Computes determinant of a 3x3 matrix.
 */
export function det3x3(M) {
  return (
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0])
  );
}

/**
 * Jacobi eigenvalue algorithm for 3x3 real symmetric matrix.
 * Returns { eigenvalues: [e1, e2, e3], eigenvectors: 3x3 matrix (columns are eigenvectors) }
 */
function jacobiEigenvalues3x3(A, maxIter = 50) {
  // Copy A
  const S = [
    [A[0][0], A[0][1], A[0][2]],
    [A[1][0], A[1][1], A[1][2]],
    [A[2][0], A[2][1], A[2][2]],
  ];

  // Identity matrix for eigenvectors
  const V = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (let iter = 0; iter < maxIter; iter++) {
    // Find largest off-diagonal element
    let p = 0, q = 1;
    let maxOff = Math.abs(S[0][1]);
    if (Math.abs(S[0][2]) > maxOff) { p = 0; q = 2; maxOff = Math.abs(S[0][2]); }
    if (Math.abs(S[1][2]) > maxOff) { p = 1; q = 2; maxOff = Math.abs(S[1][2]); }

    if (maxOff < 1e-12) break;

    const app = S[p][p];
    const aqq = S[q][q];
    const apq = S[p][q];

    const theta = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(theta);
    const s = Math.sin(theta);

    // Givens rotation update on S
    for (let i = 0; i < 3; i++) {
      if (i !== p && i !== q) {
        const aip = S[i][p];
        const aiq = S[i][q];
        S[i][p] = S[p][i] = c * aip - s * aiq;
        S[i][q] = S[q][i] = s * aip + c * aiq;
      }
    }
    S[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    S[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    S[p][q] = S[q][p] = 0;

    // Accumulate eigenvectors in V
    for (let i = 0; i < 3; i++) {
      const vip = V[i][p];
      const viq = V[i][q];
      V[i][p] = c * vip - s * viq;
      V[i][q] = s * vip + c * viq;
    }
  }

  return {
    eigenvalues: [S[0][0], S[1][1], S[2][2]],
    eigenvectors: V,
  };
}

/**
 * Computes SVD of arbitrary 3x3 matrix H = U * S * V^T using normal equations (H^T * H).
 */
function svd3x3(H) {
  const Ht = transpose3x3(H);
  const HtH = matMul3x3(Ht, H);

  // Eigenvectors of HtH give V
  const { eigenvalues, eigenvectors: V } = jacobiEigenvalues3x3(HtH);

  // Singular values
  const s0 = Math.sqrt(Math.max(0, eigenvalues[0]));
  const s1 = Math.sqrt(Math.max(0, eigenvalues[1]));
  const s2 = Math.sqrt(Math.max(0, eigenvalues[2]));

  // U_i = H * V_i / s_i
  const U = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  const sigmas = [s0, s1, s2];
  for (let j = 0; j < 3; j++) {
    const sj = sigmas[j];
    if (sj > 1e-9) {
      for (let i = 0; i < 3; i++) {
        U[i][j] = (H[i][0] * V[0][j] + H[i][1] * V[1][j] + H[i][2] * V[2][j]) / sj;
      }
    } else {
      // In degenerate cases, construct orthonormal vector
      U[j][j] = 1;
    }
  }

  return { U, sigmas, V };
}

/**
 * Computes rigid Kabsch-Umeyama transformation (Scale, Rotation, Translation)
 * mapping source points to target points.
 */
export function computeRigidTransform(rawSource, rawTarget, computeScale = false) {
  const src = validateAndSanitizeLandmarks(rawSource);
  const tgt = validateAndSanitizeLandmarks(rawTarget);

  if (src.points.length !== tgt.points.length) {
    throw new LandmarkValidationError("Source and target landmark point counts do not match", {
      sourceCount: src.points.length,
      targetCount: tgt.points.length,
    });
  }

  const n = src.points.length;

  // Covariance matrix H = sum( (P_i - P_mean) * (Q_i - Q_mean)^T )
  const H = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  for (let i = 0; i < n; i++) {
    const sp = src.points[i];
    const tp = tgt.points[i];

    const dxS = sp.x - src.centroid.x;
    const dyS = sp.y - src.centroid.y;
    const dzS = sp.z - src.centroid.z;

    const dxT = tp.x - tgt.centroid.x;
    const dyT = tp.y - tgt.centroid.y;
    const dzT = tp.z - tgt.centroid.z;

    H[0][0] += dxS * dxT;
    H[0][1] += dxS * dyT;
    H[0][2] += dxS * dzT;

    H[1][0] += dyS * dxT;
    H[1][1] += dyS * dyT;
    H[1][2] += dyS * dzT;

    H[2][0] += dzS * dxT;
    H[2][1] += dzS * dyT;
    H[2][2] += dzS * dzT;
  }

  // Compute SVD of H: H = U * Sigma * V^T
  const { U, V } = svd3x3(H);

  // R = V * U^T
  const Ut = transpose3x3(U);
  let R = matMul3x3(V, Ut);

  // Check for reflection: det(R) must be +1
  const det = det3x3(R);
  if (det < 0) {
    // Negate the last column of V to ensure a proper rotation matrix
    const Vcorrected = [
      [V[0][0], V[0][1], -V[0][2]],
      [V[1][0], V[1][1], -V[1][2]],
      [V[2][0], V[2][1], -V[2][2]],
    ];
    R = matMul3x3(Vcorrected, Ut);
  }

  let scale = 1.0;
  if (computeScale) {
    scale = Math.sqrt(tgt.variance / src.variance);
  }

  // Translation: t = centroid_tgt - scale * R * centroid_src
  const rotCentroidSrc = {
    x: R[0][0] * src.centroid.x + R[0][1] * src.centroid.y + R[0][2] * src.centroid.z,
    y: R[1][0] * src.centroid.x + R[1][1] * src.centroid.y + R[1][2] * src.centroid.z,
    z: R[2][0] * src.centroid.x + R[2][1] * src.centroid.y + R[2][2] * src.centroid.z,
  };

  const translation = {
    x: tgt.centroid.x - scale * rotCentroidSrc.x,
    y: tgt.centroid.y - scale * rotCentroidSrc.y,
    z: tgt.centroid.z - scale * rotCentroidSrc.z,
  };

  // Compute RMSE
  let sqErrorSum = 0;
  for (let i = 0; i < n; i++) {
    const sp = src.points[i];
    const tp = tgt.points[i];

    const tx = scale * (R[0][0] * sp.x + R[0][1] * sp.y + R[0][2] * sp.z) + translation.x;
    const ty = scale * (R[1][0] * sp.x + R[1][1] * sp.y + R[1][2] * sp.z) + translation.y;
    const tz = scale * (R[2][0] * sp.x + R[2][1] * sp.y + R[2][2] * sp.z) + translation.z;

    const ex = tx - tp.x;
    const ey = ty - tp.y;
    const ez = tz - tp.z;
    sqErrorSum += ex * ex + ey * ey + ez * ez;
  }
  const rmse = Math.sqrt(sqErrorSum / n);

  return {
    rotation: R,
    scale,
    translation,
    rmse,
    sourceCentroid: src.centroid,
    targetCentroid: tgt.centroid,
  };
}

/**
 * Low-pass filter component for 1-Euro Filter.
 */
class LowPassFilter {
  constructor(alpha = 1.0) {
    this.alpha = alpha;
    this.s = null;
  }

  filter(value, alpha = this.alpha) {
    if (this.s === null) {
      this.s = value;
    } else {
      this.s = alpha * value + (1.0 - alpha) * this.s;
    }
    return this.s;
  }
}

/**
 * 1-Euro Filter for 3D landmarks (Casiez et al., CHI 2012).
 * Adapts cutoff frequency dynamically based on signal derivative.
 */
export class OneEuroFilter3D {
  constructor({ minCutoff = 1.0, beta = 0.007, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xFilter = new LowPassFilter();
    this.yFilter = new LowPassFilter();
    this.zFilter = new LowPassFilter();
    this.dxFilter = new LowPassFilter();
    this.dyFilter = new LowPassFilter();
    this.dzFilter = new LowPassFilter();
    this.lastTime = null;
  }

  alpha(rate, cutoff) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    const te = 1.0 / rate;
    return 1.0 / (1.0 + tau / te);
  }

  filter(point, timestamp) {
    if (this.lastTime === null) {
      this.lastTime = timestamp;
      return {
        x: this.xFilter.filter(point.x),
        y: this.yFilter.filter(point.y),
        z: this.zFilter.filter(point.z),
      };
    }

    const dt = Math.max(1e-4, timestamp - this.lastTime);
    const rate = 1.0 / dt;
    this.lastTime = timestamp;

    const dAlpha = this.alpha(rate, this.dCutoff);

    const prevX = this.xFilter.s ?? point.x;
    const prevY = this.yFilter.s ?? point.y;
    const prevZ = this.zFilter.s ?? point.z;

    const dx = this.dxFilter.filter((point.x - prevX) * rate, dAlpha);
    const dy = this.dyFilter.filter((point.y - prevY) * rate, dAlpha);
    const dz = this.dzFilter.filter((point.z - prevZ) * rate, dAlpha);

    const speed = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const cutoff = this.minCutoff + this.beta * speed;
    const a = this.alpha(rate, cutoff);

    return {
      x: this.xFilter.filter(point.x, a),
      y: this.yFilter.filter(point.y, a),
      z: this.zFilter.filter(point.z, a),
    };
  }
}
