/**
 * Sensor Dropout & Gaze Interpolation Circuit Breaker for NeuroMirror.
 *
 * Implements a three-state resilience engine (CLOSED, OPEN, HALF_OPEN) defending
 * downstream biometric rendering and gaze UI tracking against sensor occlusion,
 * camera dropouts, and discontinuous coordinate loss.
 */

export const CircuitState = Object.freeze({
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
});

export const FallbackStrategy = Object.freeze({
  PASSTHROUGH: 'PASSTHROUGH',
  DEAD_RECKONING: 'DEAD_RECKONING',
  INTERPOLATED_CANARY: 'INTERPOLATED_CANARY',
});

export class GazeDropoutCircuitBreaker {
  constructor({
    dropoutThreshold = 5,
    recoveryWindowMs = 200,
    halfOpenSuccessThreshold = 3,
    velocityDecay = 0.85,
    minConfidence = 0.25,
  } = {}) {
    if (dropoutThreshold < 1) {
      throw new Error(`dropoutThreshold must be >= 1, got ${dropoutThreshold}`);
    }
    if (recoveryWindowMs <= 0) {
      throw new Error(`recoveryWindowMs must be positive, got ${recoveryWindowMs}`);
    }
    if (halfOpenSuccessThreshold < 1) {
      throw new Error(`halfOpenSuccessThreshold must be >= 1, got ${halfOpenSuccessThreshold}`);
    }

    this.dropoutThreshold = dropoutThreshold;
    this.recoveryWindowMs = recoveryWindowMs;
    this.halfOpenSuccessThreshold = halfOpenSuccessThreshold;
    this.velocityDecay = velocityDecay;
    this.minConfidence = minConfidence;

    this.state = CircuitState.CLOSED;
    this.consecutiveDropouts = 0;
    this.consecutiveSuccesses = 0;
    this.lastValidSample = null;
    this.velocity = { vx: 0, vy: 0 };
    this.lastStateChange = Date.now();
    this.tripCount = 0;
    this.totalEvaluated = 0;
    this.interpolatedFrames = 0;
  }

  /**
   * Process a raw gaze coordinate frame through the circuit breaker.
   */
  processFrame(rawFrame, now = Date.now()) {
    this.totalEvaluated++;

    const isValid = this._validateRawFrame(rawFrame);

    // Timeout check: transition OPEN to HALF_OPEN after recovery window
    if (this.state === CircuitState.OPEN && (now - this.lastStateChange >= this.recoveryWindowMs)) {
      this.state = CircuitState.HALF_OPEN;
      this.consecutiveSuccesses = 0;
      this.lastStateChange = now;
    }

    if (isValid) {
      return this._handleValidFrame(rawFrame, now);
    } else {
      return this._handleDropoutFrame(rawFrame, now);
    }
  }

  _validateRawFrame(frame) {
    if (!frame || typeof frame !== 'object') return false;
    const { x, y, confidence } = frame;
    if (typeof x !== 'number' || typeof y !== 'number') return false;
    if (Number.isNaN(x) || Number.isNaN(y) || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (typeof confidence === 'number' && confidence < this.minConfidence) return false;
    return true;
  }

  _handleValidFrame(frame, now) {
    this.consecutiveDropouts = 0;

    // Compute velocity if prior sample exists
    if (this.lastValidSample) {
      const dt = Math.max(1, now - (this.lastValidSample.timestamp || now));
      this.velocity = {
        vx: (frame.x - this.lastValidSample.x) / dt,
        vy: (frame.y - this.lastValidSample.y) / dt,
      };
    }

    if (this.state === CircuitState.HALF_OPEN) {
      this.consecutiveSuccesses++;

      // Smooth blending with previous extrapolated point
      const blend = 0.5;
      const smoothX = this.lastValidSample ? (this.lastValidSample.x * (1 - blend) + frame.x * blend) : frame.x;
      const smoothY = this.lastValidSample ? (this.lastValidSample.y * (1 - blend) + frame.y * blend) : frame.y;

      const output = {
        x: Math.round(smoothX * 100) / 100,
        y: Math.round(smoothY * 100) / 100,
        confidence: frame.confidence !== undefined ? frame.confidence : 0.8,
        circuitState: this.state,
        strategy: FallbackStrategy.INTERPOLATED_CANARY,
        interpolated: true,
        timestamp: now,
      };

      this.lastValidSample = { ...output, timestamp: now };

      if (this.consecutiveSuccesses >= this.halfOpenSuccessThreshold) {
        this.state = CircuitState.CLOSED;
        this.consecutiveSuccesses = 0;
        this.lastStateChange = now;
      }

      return output;
    }

    // CLOSED state: pass through
    const output = {
      x: frame.x,
      y: frame.y,
      confidence: frame.confidence !== undefined ? frame.confidence : 1.0,
      circuitState: CircuitState.CLOSED,
      strategy: FallbackStrategy.PASSTHROUGH,
      interpolated: false,
      timestamp: now,
    };

    this.lastValidSample = { ...output, timestamp: now };
    return output;
  }

  _handleDropoutFrame(rawFrame, now) {
    this.consecutiveDropouts++;
    this.interpolatedFrames++;

    if (this.state === CircuitState.HALF_OPEN) {
      // Immediate re-trip on dropout during canary probe
      this._trip(now);
    } else if (this.state === CircuitState.CLOSED && this.consecutiveDropouts >= this.dropoutThreshold) {
      this._trip(now);
    }

    // Dead-reckoning extrapolation from last valid coordinate
    let estX = 0;
    let estY = 0;
    let estConfidence = 0.1;

    if (this.lastValidSample) {
      const dt = Math.max(1, now - (this.lastValidSample.timestamp || now));
      estX = this.lastValidSample.x + this.velocity.vx * dt * this.velocityDecay;
      estY = this.lastValidSample.y + this.velocity.vy * dt * this.velocityDecay;
      estConfidence = Math.max(0.05, (this.lastValidSample.confidence || 0.5) * 0.7);

      // Dampen velocity for subsequent extrapolated steps
      this.velocity.vx *= this.velocityDecay;
      this.velocity.vy *= this.velocityDecay;
    }

    const output = {
      x: Math.round(estX * 100) / 100,
      y: Math.round(estY * 100) / 100,
      confidence: Math.round(estConfidence * 100) / 100,
      circuitState: this.state,
      strategy: FallbackStrategy.DEAD_RECKONING,
      interpolated: true,
      timestamp: now,
      dropoutCount: this.consecutiveDropouts,
    };

    this.lastValidSample = { ...output, timestamp: now };
    return output;
  }

  _trip(now) {
    this.state = CircuitState.OPEN;
    this.tripCount++;
    this.lastStateChange = now;
    this.consecutiveSuccesses = 0;
  }

  reset() {
    this.state = CircuitState.CLOSED;
    this.consecutiveDropouts = 0;
    this.consecutiveSuccesses = 0;
    this.lastValidSample = null;
    this.velocity = { vx: 0, vy: 0 };
    this.lastStateChange = Date.now();
  }

  getMetrics() {
    return {
      state: this.state,
      tripCount: this.tripCount,
      totalEvaluated: this.totalEvaluated,
      interpolatedFrames: this.interpolatedFrames,
      consecutiveDropouts: this.consecutiveDropouts,
    };
  }
}
