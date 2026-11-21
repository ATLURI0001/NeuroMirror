/**
 * Biometric Kalman Filter & Sensor Dropout Coasting Engine for NeuroMirror.
 * Tracks continuous biometric signals (gaze position, pupil diameter, PPG/HR)
 * through transient occlusions, blinks, and high-frequency sensor noise.
 */

export class BiometricKalman1D {
  /**
   * @param {Object} [options]
   * @param {number} [options.processNoise=0.1] - Process variance (Q).
   * @param {number} [options.measurementNoise=0.1] - Measurement variance (R).
   * @param {number} [options.maxCoastFrames=15] - Maximum consecutive dropout frames to coast.
   * @param {number} [options.outlierThreshold=4.0] - Mahalanobis deviation gate for anomaly rejection.
   * @param {number} [options.minConfidence=0.25] - Minimum sensor confidence required for measurement update.
   */
  constructor(options = {}) {
    this.q = Number(options.processNoise) > 0 ? Number(options.processNoise) : 0.1;
    this.r = Number(options.measurementNoise) > 0 ? Number(options.measurementNoise) : 0.1;
    this.maxCoastFrames = Number.isInteger(options.maxCoastFrames) && options.maxCoastFrames > 0 ? options.maxCoastFrames : 15;
    this.outlierThreshold = Number(options.outlierThreshold) > 0 ? Number(options.outlierThreshold) : 4.0;
    this.minConfidence = Number(options.minConfidence) >= 0 ? Number(options.minConfidence) : 0.25;

    this.reset();
  }

  reset(initialValue = null) {
    this.pos = initialValue !== null && Number.isFinite(initialValue) ? initialValue : 0;
    this.vel = 0;
    // Initial error covariance P: high velocity uncertainty initially
    this.p00 = this.r * 2.0;
    this.p01 = 0.0;
    this.p10 = 0.0;
    this.p11 = 50.0;
    this.coastFrames = 0;
    this.turnCount = 0;
    this.isInitialized = initialValue !== null && Number.isFinite(initialValue);
  }

  /**
   * Updates state with a new measurement observation.
   * @param {number|null} measurement - Observed scalar value.
   * @param {number} dt - Elapsed seconds since last frame.
   * @param {number} [confidence=1.0] - Sensor confidence score in [0.0, 1.0].
   * @returns {{ value: number, velocity: number, isCoasting: boolean, isOutlier: boolean, status: string }}
   */
  update(measurement, dt, confidence = 1.0) {
    const validDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.5) : 0.016;
    const conf = Number.isFinite(confidence) ? Math.max(0.0, Math.min(1.0, confidence)) : 0.0;
    const isAvailable = measurement !== null && measurement !== undefined && Number.isFinite(measurement);

    // Initial seed if not yet initialized
    if (!this.isInitialized) {
      if (isAvailable && conf >= this.minConfidence) {
        this.reset(measurement);
        this.turnCount = 1;
        return {
          value: this.pos,
          velocity: this.vel,
          isCoasting: false,
          isOutlier: false,
          status: 'TRACKING',
        };
      }
      return {
        value: 0,
        velocity: 0,
        isCoasting: true,
        isOutlier: false,
        status: 'UNINITIALIZED',
      };
    }

    // --- 1. KINEMATIC PREDICTION STEP ---
    // x_k|k-1 = F * x_k-1|k-1
    this.pos += this.vel * validDt;

    // P_k|k-1 = F * P_k-1|k-1 * F^T + Q
    const dt2 = validDt * validDt;
    const dt3 = dt2 * validDt;
    const dt4 = dt2 * dt2;
    const q00 = this.q * (dt4 / 4);
    const q01 = this.q * (dt3 / 2);
    const q11 = this.q * dt2;

    const p00_pred = this.p00 + validDt * (this.p01 + this.p10) + dt2 * this.p11 + q00;
    const p01_pred = this.p01 + validDt * this.p11 + q01;
    const p10_pred = this.p10 + validDt * this.p11 + q01;
    const p11_pred = this.p11 + q11;

    // --- 2. MEASUREMENT GATING & COASTING CHECK ---
    const shouldCoast = !isAvailable || conf < this.minConfidence;
    if (shouldCoast) {
      this.p00 = p00_pred;
      this.p01 = p01_pred;
      this.p10 = p10_pred;
      this.p11 = p11_pred;

      this.coastFrames++;
      if (this.coastFrames >= this.maxCoastFrames) {
        // Friction dampening on prolonged dropout
        this.vel *= 0.85;
      }
      return {
        value: this.pos,
        velocity: this.vel,
        isCoasting: true,
        isOutlier: false,
        status: this.coastFrames >= this.maxCoastFrames ? 'LOST' : 'COASTING',
      };
    }

    // --- 3. OUTLIER REJECTION GATE (Mahalanobis Distance) ---
    const innovation = measurement - this.pos;
    const dynamicR = this.r / Math.max(0.1, conf);
    const innovationVariance = p00_pred + dynamicR;
    const stdDev = Math.sqrt(Math.max(1e-6, innovationVariance));
    const mahalanobis = Math.abs(innovation) / stdDev;

    // Only gate outliers once tracker has observed at least 3 frames
    if (this.turnCount >= 3 && mahalanobis > this.outlierThreshold) {
      this.p00 = p00_pred;
      this.p01 = p01_pred;
      this.p10 = p10_pred;
      this.p11 = p11_pred;

      this.coastFrames++;
      return {
        value: this.pos,
        velocity: this.vel,
        isCoasting: true,
        isOutlier: true,
        status: 'OUTLIER_COASTING',
      };
    }

    // --- 4. MEASUREMENT UPDATE STEP (Correction) ---
    const k0 = p00_pred / innovationVariance;
    const k1 = p10_pred / innovationVariance;

    this.pos += k0 * innovation;
    this.vel += k1 * innovation;

    this.p00 = (1.0 - k0) * p00_pred;
    this.p01 = (1.0 - k0) * p01_pred;
    this.p10 = -k1 * p00_pred + p10_pred;
    this.p11 = -k1 * p01_pred + p11_pred;

    this.coastFrames = 0;
    this.turnCount++;

    return {
      value: this.pos,
      velocity: this.vel,
      isCoasting: false,
      isOutlier: false,
      status: 'TRACKING',
    };
  }
}

/**
 * 2D Kinematic Kalman Filter fusing dual orthogonal axes for gaze or planar tracking.
 */
export class BiometricKalman2D {
  constructor(options = {}) {
    this.filterX = new BiometricKalman1D(options);
    this.filterY = new BiometricKalman1D(options);
  }

  reset(initialX = null, initialY = null) {
    this.filterX.reset(initialX);
    this.filterY.reset(initialY);
  }

  update(x, y, dt, confidence = 1.0) {
    const rx = this.filterX.update(x, dt, confidence);
    const ry = this.filterY.update(y, dt, confidence);

    const isCoasting = rx.isCoasting || ry.isCoasting;
    const isOutlier = rx.isOutlier || ry.isOutlier;
    const status = rx.status === 'LOST' || ry.status === 'LOST' ? 'LOST' : rx.status;

    return {
      x: rx.value,
      y: ry.value,
      vx: rx.velocity,
      vy: ry.velocity,
      isCoasting,
      isOutlier,
      status,
    };
  }
}
