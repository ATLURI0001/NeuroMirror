/**
 * Saccade Velocity Kinematics & Fixation Stability Guard.
 * Computes high-frequency angular velocities, accelerations, Bivariate Contour
 * Ellipse Area (BCEA), and provides defensive filtering against non-monotonic frames and blinks.
 */

export const KinematicMovementClass = {
  FIXATION: 'fixation',
  MICROSACCADE: 'microsaccade',
  SACCADE: 'saccade',
  GLISSADE: 'glissade',
  UNKNOWN: 'unknown',
};

export class SaccadeKinematicsGuard {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.pixelsPerDegree=35.0] - Display scale mapping pixels to visual angle degrees.
   * @param {number} [options.microsaccadeMinVelocity=30.0] - deg/s threshold for microsaccade onset.
   * @param {number} [options.saccadeMinVelocity=200.0] - deg/s threshold for ballistic macro-saccade onset.
   * @param {number} [options.maxSaccadeVelocity=1200.0] - Physiological ceiling (deg/s) to filter sensor glitches.
   * @param {number} [options.historyWindowMs=1000.0] - Sliding temporal buffer for fixation dispersion (ms).
   */
  constructor(options = {}) {
    const ppd = Number(options.pixelsPerDegree);
    this.pixelsPerDegree = Number.isFinite(ppd) && ppd > 0 ? ppd : 35.0;

    const microThresh = Number(options.microsaccadeMinVelocity);
    this.microsaccadeMinVelocity = Number.isFinite(microThresh) && microThresh > 0 ? microThresh : 30.0;

    const sacThresh = Number(options.saccadeMinVelocity);
    this.saccadeMinVelocity = Number.isFinite(sacThresh) && sacThresh > this.microsaccadeMinVelocity
      ? sacThresh
      : 200.0;

    const maxVel = Number(options.maxSaccadeVelocity);
    this.maxSaccadeVelocity = Number.isFinite(maxVel) && maxVel > this.saccadeMinVelocity
      ? maxVel
      : 1200.0;

    const windowMs = Number(options.historyWindowMs);
    this.historyWindowMs = Number.isFinite(windowMs) && windowMs >= 200 ? windowMs : 1000.0;

    this.lastSample = null;
    this.lastVelocity = 0.0;

    /** @type {Array<{ x: number, y: number, timestampMs: number, classification: string }>} */
    this.history = [];
  }

  /**
   * Evaluates instantaneous gaze kinematics for a frame.
   * @param {Object} frame
   * @param {number} frame.x - Horizontal pixel coordinate.
   * @param {number} frame.y - Vertical pixel coordinate.
   * @param {number} frame.timestampMs - Millisecond epoch timestamp.
   * @param {number} [frame.pupilDiameter=3.0] - Measured pupil diameter (mm).
   * @returns {Object} Kinematic classification, angular velocity, and acceleration.
   */
  processFrame(frame) {
    if (!frame || typeof frame !== 'object') {
      return this._fallbackKinematics('Invalid frame payload');
    }

    const x = Number(frame.x);
    const y = Number(frame.y);
    const t = Number(frame.timestampMs);
    const pupil = Number(frame.pupilDiameter ?? 3.0);

    // Defensive guards: finite coordinates & positive timestamps
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(t) || t <= 0) {
      return this._fallbackKinematics('Non-finite coordinate or invalid timestamp');
    }

    // Blink detection: pupil collapsed to 0 or negative
    if (pupil <= 0.0) {
      this.lastSample = null;
      this.lastVelocity = 0.0;
      return {
        classification: KinematicMovementClass.UNKNOWN,
        isBlink: true,
        velocityDegPerSec: 0.0,
        accelerationDegPerSec2: 0.0,
        bceaDegrees2: 0.0,
      };
    }

    if (!this.lastSample) {
      this.lastSample = { x, y, timestampMs: t };
      this.lastVelocity = 0.0;
      this._appendHistory(x, y, t, KinematicMovementClass.FIXATION);
      return {
        classification: KinematicMovementClass.FIXATION,
        isBlink: false,
        velocityDegPerSec: 0.0,
        accelerationDegPerSec2: 0.0,
        bceaDegrees2: 0.0,
      };
    }

    // Monotonic timestamp check
    const dt = (t - this.lastSample.timestampMs) / 1000.0; // in seconds
    if (dt <= 0.001 || dt > 0.5) {
      // Discontinuous or backward timestamp: reset baseline
      this.lastSample = { x, y, timestampMs: t };
      this.lastVelocity = 0.0;
      return this._fallbackKinematics('Timestamp non-monotonic or interval too wide');
    }

    // Calculate angular displacement in degrees
    const dx = x - this.lastSample.x;
    const dy = y - this.lastSample.y;
    const pixelDistance = Math.hypot(dx, dy);
    const degreeDisplacement = pixelDistance / this.pixelsPerDegree;

    // Instantaneous angular velocity (deg/s)
    let velocityDegPerSec = degreeDisplacement / dt;

    // Physiological clamping: reject impossible camera jump glitches
    if (velocityDegPerSec > this.maxSaccadeVelocity) {
      velocityDegPerSec = this.maxSaccadeVelocity;
    }

    // Angular acceleration (deg/s^2)
    const accelerationDegPerSec2 = (velocityDegPerSec - this.lastVelocity) / dt;

    // Classify movement state
    let classification = KinematicMovementClass.FIXATION;
    if (velocityDegPerSec >= this.saccadeMinVelocity) {
      classification = KinematicMovementClass.SACCADE;
    } else if (this.lastVelocity >= this.saccadeMinVelocity && velocityDegPerSec >= 5.0) {
      classification = KinematicMovementClass.GLISSADE;
    } else if (velocityDegPerSec >= this.microsaccadeMinVelocity) {
      classification = KinematicMovementClass.MICROSACCADE;
    }

    this.lastSample = { x, y, timestampMs: t };
    this.lastVelocity = velocityDegPerSec;
    this._appendHistory(x, y, t, classification);

    const bcea = this.computeFixationBCEA();

    return {
      classification,
      isBlink: false,
      velocityDegPerSec: Number(velocityDegPerSec.toFixed(2)),
      accelerationDegPerSec2: Number(accelerationDegPerSec2.toFixed(2)),
      amplitudeDegrees: Number(degreeDisplacement.toFixed(3)),
      bceaDegrees2: Number(bcea.toFixed(4)),
    };
  }

  /**
   * Computes the Bivariate Contour Ellipse Area (BCEA) for fixation stability.
   * Uses 68.2% confidence factor (k = 1.14):
   * BCEA = 2 * k * pi * sigma_x * sigma_y * sqrt(1 - r^2)
   * @returns {number} Ellipse area in deg^2.
   */
  computeFixationBCEA() {
    const fixationSamples = this.history.filter(
      (h) => h.classification === KinematicMovementClass.FIXATION
    );

    if (fixationSamples.length < 5) {
      return 0.0;
    }

    const n = fixationSamples.length;
    let sumX = 0;
    let sumY = 0;
    for (const s of fixationSamples) {
      sumX += s.x / this.pixelsPerDegree;
      sumY += s.y / this.pixelsPerDegree;
    }
    const meanX = sumX / n;
    const meanY = sumY / n;

    let varX = 0;
    let varY = 0;
    let covXY = 0;

    for (const s of fixationSamples) {
      const dx = (s.x / this.pixelsPerDegree) - meanX;
      const dy = (s.y / this.pixelsPerDegree) - meanY;
      varX += dx * dx;
      varY += dy * dy;
      covXY += dx * dy;
    }

    const stdX = Math.sqrt(varX / (n - 1));
    const stdY = Math.sqrt(varY / (n - 1));

    if (stdX === 0 || stdY === 0) {
      return 0.0;
    }

    const r = covXY / ((n - 1) * stdX * stdY);
    const clampedR = Math.max(-0.999, Math.min(0.999, r));
    const k = 1.14; // 68.2% probability area

    return 2.0 * k * Math.PI * stdX * stdY * Math.sqrt(1.0 - clampedR * clampedR);
  }

  /**
   * @private
   */
  _appendHistory(x, y, t, classification) {
    this.history.push({ x, y, timestampMs: t, classification });
    const cutoff = t - this.historyWindowMs;
    while (this.history.length > 0 && this.history[0].timestampMs < cutoff) {
      this.history.shift();
    }
  }

  /**
   * @private
   */
  _fallbackKinematics(reason) {
    return {
      classification: KinematicMovementClass.UNKNOWN,
      isBlink: false,
      velocityDegPerSec: 0.0,
      accelerationDegPerSec2: 0.0,
      bceaDegrees2: 0.0,
      reason,
    };
  }

  /**
   * Resets all internal buffers and state.
   */
  reset() {
    this.lastSample = null;
    this.lastVelocity = 0.0;
    this.history = [];
  }
}
