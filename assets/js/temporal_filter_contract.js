/**
 * Temporal Head Orientation & Landmark Kalman Contract Engine.
 *
 * Enforces strictly-typed temporal delta intervals, quaternion normalization,
 * Mahalanobis outlier rejection, and kinematic state prediction for AR face tracking.
 */

export const TrackingState = Object.freeze({
  UNINITIALIZED: "UNINITIALIZED",
  TRACKING: "TRACKING",
  COASTING: "COASTING",
  LOST: "LOST",
});

/**
 * Validate and sanitize timestamp delta.
 */
export function sanitizeDeltaTime(prevTimestamp, currTimestamp) {
  if (typeof currTimestamp !== "number" || !Number.isFinite(currTimestamp)) {
    throw new TypeError(`currTimestamp must be a finite number, got ${currTimestamp}`);
  }
  if (prevTimestamp === null || prevTimestamp === undefined) {
    return 1.0 / 60.0;
  }
  if (typeof prevTimestamp !== "number" || !Number.isFinite(prevTimestamp)) {
    throw new TypeError(`prevTimestamp must be a finite number, got ${prevTimestamp}`);
  }
  const dt = currTimestamp - prevTimestamp;
  if (dt <= 0.0) {
    throw new RangeError(`Non-monotonic timestamp: currTimestamp (${currTimestamp}) <= prevTimestamp (${prevTimestamp})`);
  }
  return Math.min(0.5, Math.max(0.001, dt));
}

/**
 * Sanitize and normalize unit quaternion [x, y, z, w].
 */
export function normalizeQuaternion(q) {
  if (!Array.isArray(q) || q.length !== 4) {
    throw new TypeError("Quaternion must be an array of 4 numbers [x, y, z, w]");
  }
  for (let i = 0; i < 4; i++) {
    if (typeof q[i] !== "number" || !Number.isFinite(q[i])) {
      throw new TypeError(`Quaternion element ${i} is not a finite number`);
    }
  }
  const normSq = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
  if (normSq < 1e-12) {
    return [0, 0, 0, 1];
  }
  const invNorm = 1.0 / Math.sqrt(normSq);
  return [q[0] * invNorm, q[1] * invNorm, q[2] * invNorm, q[3] * invNorm];
}

/**
 * Convert quaternion to Euler angles [pitch, yaw, roll] in radians with unwrapping.
 */
export function quaternionToEuler(q) {
  const [x, y, z, w] = normalizeQuaternion(q);

  const sinr_cosp = 2 * (w * x + y * z);
  const cosr_cosp = 1 - 2 * (x * x + y * y);
  const pitch = Math.atan2(sinr_cosp, cosr_cosp);

  const sinp = 2 * (w * y - z * x);
  let yaw;
  if (Math.abs(sinp) >= 1) {
    yaw = Math.sign(sinp) * (Math.PI / 2);
  } else {
    yaw = Math.asin(sinp);
  }

  const siny_cosp = 2 * (w * z + x * y);
  const cosy_cosp = 1 - 2 * (y * y + z * z);
  const roll = Math.atan2(siny_cosp, cosy_cosp);

  return { pitch, yaw, roll };
}

/**
 * 3D Kinematic Kalman Filter with Mahalanobis Outlier Rejection and Coasting.
 */
export class LandmarkKalmanFilter3D {
  constructor(options = {}) {
    this.alpha = options.alpha ?? 0.7; // kinematic position gain
    this.beta = options.beta ?? 0.3; // kinematic velocity gain
    this.processNoise = options.processNoise ?? 0.01;
    this.measurementNoise = options.measurementNoise ?? 0.05;
    this.mahalanobisGate = options.mahalanobisGate ?? 11.34;
    this.maxCoastingFrames = options.maxCoastingFrames ?? 15;

    this.state = new Float64Array(6);
    this.cov = new Float64Array(3).fill(1.0);

    this.lastTimestamp = null;
    this.coastingCount = 0;
    this.status = TrackingState.UNINITIALIZED;
  }

  reset() {
    this.state.fill(0);
    this.cov.fill(1.0);
    this.lastTimestamp = null;
    this.coastingCount = 0;
    this.status = TrackingState.UNINITIALIZED;
  }

  predict(dt) {
    for (let i = 0; i < 3; i++) {
      this.state[i] += this.state[i + 3] * dt;
      this.cov[i] += this.processNoise * dt;
    }
  }

  update(measurement, timestamp) {
    if (!Array.isArray(measurement) || measurement.length !== 3) {
      throw new TypeError("Measurement must be a 3-element array [x, y, z]");
    }
    for (let i = 0; i < 3; i++) {
      if (typeof measurement[i] !== "number" || !Number.isFinite(measurement[i])) {
        throw new TypeError(`Measurement index ${i} is not a finite number`);
      }
    }

    if (this.status === TrackingState.UNINITIALIZED || this.status === TrackingState.LOST) {
      this.state[0] = measurement[0];
      this.state[1] = measurement[1];
      this.state[2] = measurement[2];
      this.state[3] = 0.0;
      this.state[4] = 0.0;
      this.state[5] = 0.0;
      this.cov.fill(1.0);
      this.lastTimestamp = timestamp;
      this.coastingCount = 0;
      this.status = TrackingState.TRACKING;
      return {
        position: [this.state[0], this.state[1], this.state[2]],
        velocity: [0, 0, 0],
        status: this.status,
        gatedOutlier: false,
      };
    }

    const dt = sanitizeDeltaTime(this.lastTimestamp, timestamp);
    this.predict(dt);

    const residual = [
      measurement[0] - this.state[0],
      measurement[1] - this.state[1],
      measurement[2] - this.state[2],
    ];

    let mahalanobisSq = 0.0;
    for (let i = 0; i < 3; i++) {
      const s = this.cov[i] + this.measurementNoise;
      mahalanobisSq += (residual[i] * residual[i]) / s;
    }

    if (mahalanobisSq > this.mahalanobisGate) {
      this.coastingCount++;
      this.status = this.coastingCount > this.maxCoastingFrames ? TrackingState.LOST : TrackingState.COASTING;
      this.lastTimestamp = timestamp;
      return {
        position: [this.state[0], this.state[1], this.state[2]],
        velocity: [this.state[3], this.state[4], this.state[5]],
        status: this.status,
        gatedOutlier: true,
        mahalanobisDistanceSq: mahalanobisSq,
      };
    }

    for (let i = 0; i < 3; i++) {
      this.state[i] += this.alpha * residual[i];
      this.state[i + 3] += (this.beta / dt) * residual[i];
      this.cov[i] = (1 - this.alpha) * this.cov[i] + this.processNoise * dt;
    }

    this.lastTimestamp = timestamp;
    this.coastingCount = 0;
    this.status = TrackingState.TRACKING;

    return {
      position: [this.state[0], this.state[1], this.state[2]],
      velocity: [this.state[3], this.state[4], this.state[5]],
      status: this.status,
      gatedOutlier: false,
      mahalanobisDistanceSq: mahalanobisSq,
    };
  }
}
