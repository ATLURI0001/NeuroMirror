/**
 * Head Pose Orientation Jitter & Gimbal Lock Circuit Breaker.
 * 
 * Protects 3D avatar rendering from Euler angle singularities (pitch ~ +/-90 deg),
 * excessive rotational jitter, sensor dropout, and numerical instability.
 */

const CircuitState = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
};

class HeadPoseCircuitBreaker {
  /**
   * @param {Object} options
   * @param {number} [options.pitchSingularityThreshold=85.0] Degrees pitch boundary
   * @param {number} [options.maxAngularVelocityDegPerSec=720.0] Max allowable rotational velocity
   * @param {number} [options.failureThreshold=3] Consecutive invalid frames to trip circuit
   * @param {number} [options.recoverySuccessThreshold=5] Stable frames to close circuit
   * @param {number} [options.cooldownPeriodMs=1000] Milliseconds to remain OPEN before HALF_OPEN
   * @param {number} [options.smoothingFactor=0.3] Exponential moving average alpha [0-1]
   */
  constructor(options = {}) {
    this.pitchSingularityThreshold = options.pitchSingularityThreshold ?? 85.0;
    this.maxAngularVelocityDegPerSec = options.maxAngularVelocityDegPerSec ?? 720.0;
    this.failureThreshold = options.failureThreshold ?? 3;
    this.recoverySuccessThreshold = options.recoverySuccessThreshold ?? 5;
    this.cooldownPeriodMs = options.cooldownPeriodMs ?? 1000;
    this.smoothingFactor = options.smoothingFactor ?? 0.3;

    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.tripTime = 0;
    this.tripReason = null;

    this.lastValidPose = { pitch: 0, yaw: 0, roll: 0 };
    this.lastTimestamp = 0;
  }

  /**
   * Evaluates input pose and returns sanitized orientation.
   * @param {{pitch: number, yaw: number, roll: number}} pose
   * @param {number} [timestamp=Date.now()]
   * @returns {{pose: {pitch: number, yaw: number, roll: number}, state: string, fallbackApplied: boolean, reason?: string}}
   */
  processPose(pose, timestamp = Date.now()) {
    const dtSeconds = this.lastTimestamp > 0 ? Math.max(0.001, (timestamp - this.lastTimestamp) / 1000) : 0.016;

    // Transition from OPEN to HALF_OPEN after cooldown
    if (this.state === CircuitState.OPEN && timestamp - this.tripTime >= this.cooldownPeriodMs) {
      this.state = CircuitState.HALF_OPEN;
      this.consecutiveSuccesses = 0;
    }

    const validity = this._validatePose(pose, dtSeconds);

    if (!validity.valid) {
      this.consecutiveFailures++;
      this.consecutiveSuccesses = 0;

      if (this.state === CircuitState.HALF_OPEN || this.consecutiveFailures >= this.failureThreshold) {
        this._trip(validity.reason, timestamp);
      }

      return {
        pose: { ...this.lastValidPose },
        state: this.state,
        fallbackApplied: true,
        reason: validity.reason,
      };
    }

    // Pose is physically valid
    if (this.state === CircuitState.OPEN) {
      return {
        pose: { ...this.lastValidPose },
        state: this.state,
        fallbackApplied: true,
        reason: this.tripReason || 'CIRCUIT_OPEN',
      };
    }

    if (this.state === CircuitState.HALF_OPEN) {
      this.consecutiveSuccesses++;
      if (this.consecutiveSuccesses >= this.recoverySuccessThreshold) {
        this.state = CircuitState.CLOSED;
        this.consecutiveFailures = 0;
        this.tripReason = null;
      }
    } else {
      this.consecutiveFailures = 0;
    }

    // Apply EMA smoothing
    const smoothed = this._applySmoothing(pose);
    this.lastValidPose = smoothed;
    this.lastTimestamp = timestamp;

    return {
      pose: smoothed,
      state: this.state,
      fallbackApplied: false,
    };
  }

  _validatePose(pose, dtSeconds) {
    if (!pose || typeof pose !== 'object') {
      return { valid: false, reason: 'ERR_NULL_OR_INVALID_POSE' };
    }

    const { pitch, yaw, roll } = pose;

    if (!Number.isFinite(pitch) || !Number.isFinite(yaw) || !Number.isFinite(roll)) {
      return { valid: false, reason: 'ERR_NON_FINITE_ANGULAR_VALUES' };
    }

    // Check gimbal lock singularity
    if (Math.abs(pitch) >= this.pitchSingularityThreshold) {
      return { valid: false, reason: 'ERR_GIMBAL_LOCK_SINGULARITY' };
    }

    // Check angular velocity jitter only after initial frame
    if (this.lastTimestamp > 0) {
      const deltaPitch = Math.abs(pitch - this.lastValidPose.pitch);
      const deltaYaw = Math.abs(yaw - this.lastValidPose.yaw);
      const deltaRoll = Math.abs(roll - this.lastValidPose.roll);

      const maxDelta = Math.max(deltaPitch, deltaYaw, deltaRoll);
      const angularVelocity = maxDelta / dtSeconds;

      if (angularVelocity > this.maxAngularVelocityDegPerSec) {
        return { valid: false, reason: 'ERR_ANGULAR_VELOCITY_JITTER' };
      }
    }

    return { valid: true };
  }

  _applySmoothing(target) {
    const alpha = this.smoothingFactor;
    return {
      pitch: Number((this.lastValidPose.pitch * (1 - alpha) + target.pitch * alpha).toFixed(3)),
      yaw: Number((this.lastValidPose.yaw * (1 - alpha) + target.yaw * alpha).toFixed(3)),
      roll: Number((this.lastValidPose.roll * (1 - alpha) + target.roll * alpha).toFixed(3)),
    };
  }

  _trip(reason, timestamp) {
    this.state = CircuitState.OPEN;
    this.tripTime = timestamp;
    this.tripReason = reason;
  }

  reset() {
    this.state = CircuitState.CLOSED;
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.tripTime = 0;
    this.tripReason = null;
    this.lastValidPose = { pitch: 0, yaw: 0, roll: 0 };
    this.lastTimestamp = 0;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HeadPoseCircuitBreaker, CircuitState };
}
