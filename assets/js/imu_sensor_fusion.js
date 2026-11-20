/**
 * 6-DOF IMU Sensor Fusion & Complementary Attitude Estimator.
 *
 * Fuses high-rate angular rates from a 3-axis gyroscope with gravity vectors from
 * a 3-axis accelerometer, providing drift-compensated pitch, roll, and yaw angles
 * for spatial head and device tracking in NeuroMirror.
 */

/**
 * Wrap an angular measurement in radians to the principal interval [-PI, PI].
 * @param {number} angleRad - Input angle in radians
 * @returns {number} Wrapped angle in [-PI, PI]
 */
export function wrapAngle(angleRad) {
  if (typeof angleRad !== "number" || !Number.isFinite(angleRad)) {
    throw new TypeError(`angleRad must be a finite number, received: ${angleRad}`);
  }
  let a = angleRad % (2.0 * Math.PI);
  if (a > Math.PI) a -= 2.0 * Math.PI;
  if (a < -Math.PI) a += 2.0 * Math.PI;
  return a;
}

/**
 * Calculate pitch and roll angles directly from static gravitational acceleration.
 * Assumes a right-handed coordinate system where Z points out/up, Y points forward, X points right.
 *
 * @param {number} ax - X-axis acceleration
 * @param {number} ay - Y-axis acceleration
 * @param {number} az - Z-axis acceleration
 * @returns {{ pitch: number, roll: number, magnitude: number }}
 */
export function estimateTiltFromAccel(ax, ay, az) {
  for (const [name, val] of [["ax", ax], ["ay", ay], ["az", az]]) {
    if (typeof val !== "number" || !Number.isFinite(val)) {
      throw new TypeError(`Acceleration ${name} must be a finite number, got: ${val}`);
    }
  }

  const magnitude = Math.sqrt(ax * ax + ay * ay + az * az);
  if (magnitude < 1e-6) {
    return { pitch: 0.0, roll: 0.0, magnitude: 0.0 };
  }

  // Roll: rotation about X-axis = atan2(ay, az)
  const roll = Math.atan2(ay, az);
  // Pitch: rotation about Y-axis = atan2(-ax, sqrt(ay^2 + az^2))
  const pitch = Math.atan2(-ax, Math.sqrt(ay * ay + az * az));

  return { pitch, roll, magnitude };
}

/**
 * 6-DOF Complementary Filter for IMU orientation tracking.
 */
export class ComplementaryFilter6DOF {
  /**
   * @param {object} [options]
   * @param {number} [options.alpha=0.98] - Gyroscope weight ratio in (0, 1)
   * @param {number} [options.expectedGravity=9.80665] - Expected gravity norm (m/s^2 or 1.0 if normalized)
   * @param {number} [options.gravityTolerance=0.20] - Fractional tolerance on gravity norm to gate accel fusion
   */
  constructor(options = {}) {
    const {
      alpha = 0.98,
      expectedGravity = 9.80665,
      gravityTolerance = 0.20,
    } = options;

    if (alpha <= 0.0 || alpha >= 1.0) {
      throw new RangeError(`alpha must be in range (0, 1), received: ${alpha}`);
    }
    if (expectedGravity <= 0.0) {
      throw new RangeError(`expectedGravity must be positive, received: ${expectedGravity}`);
    }
    if (gravityTolerance <= 0.0 || gravityTolerance >= 1.0) {
      throw new RangeError(`gravityTolerance must be in range (0, 1), received: ${gravityTolerance}`);
    }

    this.alpha = alpha;
    this.expectedGravity = expectedGravity;
    this.gravityTolerance = gravityTolerance;

    this.pitch = 0.0;
    this.roll = 0.0;
    this.yaw = 0.0;

    this.gyroBias = [0.0, 0.0, 0.0];
    this.isCalibrated = false;
  }

  /**
   * Calibrate stationary gyroscope bias from an array of stationary readings.
   * @param {Array<[number, number, number]>} samples - Array of [gx, gy, gz] angular velocity samples in rad/s
   */
  calibrateBias(samples) {
    if (!Array.isArray(samples) || samples.length === 0) {
      throw new TypeError("samples must be a non-empty array of gyro readings");
    }

    let sumX = 0.0;
    let sumY = 0.0;
    let sumZ = 0.0;

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (!Array.isArray(s) || s.length !== 3) {
        throw new TypeError(`Sample ${i} must be a 3-element array [gx, gy, gz]`);
      }
      for (let j = 0; j < 3; j++) {
        if (typeof s[j] !== "number" || !Number.isFinite(s[j])) {
          throw new TypeError(`Sample ${i}[${j}] is not a finite number`);
        }
      }
      sumX += s[0];
      sumY += s[1];
      sumZ += s[2];
    }

    const n = samples.length;
    this.gyroBias = [sumX / n, sumY / n, sumZ / n];
    this.isCalibrated = true;
    return [...this.gyroBias];
  }

  /**
   * Reset internal orientation state.
   */
  reset() {
    this.pitch = 0.0;
    this.roll = 0.0;
    this.yaw = 0.0;
  }

  /**
   * Process a single sensor timestamp step.
   * @param {[number, number, number]} accel - [ax, ay, az] in m/s^2
   * @param {[number, number, number]} gyro - [gx, gy, gz] in rad/s
   * @param {number} dt - Time delta in seconds
   * @returns {{ pitch: number, roll: number, yaw: number, isAccelTrusted: boolean, magnitude: number }}
   */
  update(accel, gyro, dt) {
    if (!Array.isArray(accel) || accel.length !== 3) {
      throw new TypeError("accel must be a 3-element array [ax, ay, az]");
    }
    if (!Array.isArray(gyro) || gyro.length !== 3) {
      throw new TypeError("gyro must be a 3-element array [gx, gy, gz]");
    }
    if (typeof dt !== "number" || !Number.isFinite(dt) || dt <= 0.0) {
      throw new RangeError(`dt must be a positive finite number, received: ${dt}`);
    }

    // Bias-corrected angular rates
    const wx = gyro[0] - this.gyroBias[0];
    const wy = gyro[1] - this.gyroBias[1];
    const wz = gyro[2] - this.gyroBias[2];

    // Compute accelerometer tilt and norm
    const { pitch: accPitch, roll: accRoll, magnitude } = estimateTiltFromAccel(
      accel[0],
      accel[1],
      accel[2]
    );

    // G-force gating: check if accelerometer magnitude is close to 1g
    const deltaG = Math.abs(magnitude - this.expectedGravity) / this.expectedGravity;
    const isAccelTrusted = deltaG <= this.gravityTolerance;

    // Pitch & roll fusion
    if (isAccelTrusted) {
      // High-pass gyro integration + low-pass accelerometer fusion
      this.pitch = this.alpha * (this.pitch + wx * dt) + (1.0 - this.alpha) * accPitch;
      this.roll = this.alpha * (this.roll + wy * dt) + (1.0 - this.alpha) * accRoll;
    } else {
      // Linear acceleration anomaly: trust gyro integration only to avoid tilt perturbation
      this.pitch = this.pitch + wx * dt;
      this.roll = this.roll + wy * dt;
    }

    // Yaw cannot be corrected with 3-axis accel alone (requires magnetometer); purely integrated
    this.yaw = this.yaw + wz * dt;

    this.pitch = wrapAngle(this.pitch);
    this.roll = wrapAngle(this.roll);
    this.yaw = wrapAngle(this.yaw);

    return {
      pitch: this.pitch,
      roll: this.roll,
      yaw: this.yaw,
      isAccelTrusted,
      magnitude,
    };
  }
}
