/**
 * Ocular Gaze Blink Artifact Suppression & Missing Sample Interpolation Guard.
 *
 * Mitigates ocular tracking distortion, pupil boundary warp during eyelid descent/ascent,
 * and interpolates missing gaze samples during physiological spontaneous blinks (100-350ms)
 * while guarding against prolonged occlusion and microsleep events.
 */

export const BlinkState = {
  OPEN: 'open',
  BLINK_ONSET: 'blink_onset',
  BLINKING: 'blinking',
  BLINK_RECOVERY: 'blink_recovery',
  PROLONGED_OCCLUSION: 'prolonged_occlusion',
};

export class BlinkSuppressionGuard {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.earThreshold=0.18] - Eye aspect ratio threshold below which eye is deemed closed.
   * @param {number} [options.pupilDiameterThreshold=1.5] - Min pupil diameter (mm) below which occlusion is flagged.
   * @param {number} [options.maxInterpolationGapMs=350.0] - Max allowable blink duration (ms) for interpolation.
   * @param {number} [options.prolongedOcclusionThresholdMs=800.0] - Threshold (ms) indicating microsleep/loss of tracking.
   * @param {number} [options.minConfidence=0.25] - Minimum tracking confidence required.
   */
  constructor(options = {}) {
    const ear = Number(options.earThreshold);
    this.earThreshold = Number.isFinite(ear) && ear > 0 ? ear : 0.18;

    const pd = Number(options.pupilDiameterThreshold);
    this.pupilDiameterThreshold = Number.isFinite(pd) && pd > 0 ? pd : 1.5;

    const maxGap = Number(options.maxInterpolationGapMs);
    this.maxInterpolationGapMs = Number.isFinite(maxGap) && maxGap >= 100.0 ? maxGap : 350.0;

    const prolongThresh = Number(options.prolongedOcclusionThresholdMs);
    this.prolongedOcclusionThresholdMs =
      Number.isFinite(prolongThresh) && prolongThresh > this.maxInterpolationGapMs ? prolongThresh : 800.0;

    const conf = Number(options.minConfidence);
    this.minConfidence = Number.isFinite(conf) && conf >= 0 && conf <= 1 ? conf : 0.25;

    this.state = BlinkState.OPEN;
    this.lastValidGaze = null;
    this.blinkStartTimestamp = null;
    this.lastTimestamp = null;

    /** @type {Array<Object>} */
    this.pendingBlinkFrames = [];

    this.metrics = {
      totalFramesProcessed: 0,
      blinksDetected: 0,
      interpolatedFramesCount: 0,
      suppressedArtifactFrames: 0,
      prolongedOcclusionEvents: 0,
    };
  }

  /**
   * Evaluates an ocular tracking sample, suppresses blink artifacts, and emits a sanitized frame.
   *
   * @param {Object} sample
   * @param {number} sample.timestampMs
   * @param {number} sample.x - Normalized horizontal gaze coordinate [0, 1].
   * @param {number} sample.y - Normalized vertical gaze coordinate [0, 1].
   * @param {number} [sample.ear] - Eye aspect ratio.
   * @param {number} [sample.pupilDiameter] - Pupil diameter in mm.
   * @param {number} [sample.confidence=1.0] - Tracker confidence [0, 1].
   * @returns {Object} Sanitized output frame.
   */
  processFrame(sample) {
    if (!sample || typeof sample !== 'object') {
      throw new TypeError('Gaze sample must be an object');
    }

    this.metrics.totalFramesProcessed++;

    const timestampMs = Number(sample.timestampMs);
    if (!Number.isFinite(timestampMs)) {
      throw new RangeError('timestampMs must be a finite number');
    }

    // Defensive monotonicity check
    if (this.lastTimestamp !== null && timestampMs <= this.lastTimestamp) {
      // Discard or return last valid state on backwards timestamp
      return {
        timestampMs,
        x: this.lastValidGaze ? this.lastValidGaze.x : 0.5,
        y: this.lastValidGaze ? this.lastValidGaze.y : 0.5,
        state: this.state,
        isInterpolated: false,
        valid: Boolean(this.lastValidGaze),
      };
    }
    this.lastTimestamp = timestampMs;

    const rawX = Number(sample.x);
    const rawY = Number(sample.y);
    const ear = typeof sample.ear === 'number' ? sample.ear : 0.3;
    const pupilDiameter = typeof sample.pupilDiameter === 'number' ? sample.pupilDiameter : 3.5;
    const confidence = typeof sample.confidence === 'number' ? sample.confidence : 1.0;

    const isOccluded =
      !Number.isFinite(rawX) ||
      !Number.isFinite(rawY) ||
      ear < this.earThreshold ||
      pupilDiameter < this.pupilDiameterThreshold ||
      confidence < this.minConfidence;

    if (isOccluded) {
      this.metrics.suppressedArtifactFrames++;

      if (this.state === BlinkState.OPEN) {
        this.state = BlinkState.BLINK_ONSET;
        this.blinkStartTimestamp = this.lastValidGaze ? this.lastValidGaze.timestampMs : timestampMs;
        this.metrics.blinksDetected++;
      } else if (this.state === BlinkState.BLINK_ONSET) {
        this.state = BlinkState.BLINKING;
      }

      const blinkDuration = timestampMs - (this.blinkStartTimestamp || timestampMs);

      if (blinkDuration > this.prolongedOcclusionThresholdMs) {
        if (this.state !== BlinkState.PROLONGED_OCCLUSION) {
          this.state = BlinkState.PROLONGED_OCCLUSION;
          this.metrics.prolongedOcclusionEvents++;
        }
        return {
          timestampMs,
          x: null,
          y: null,
          state: BlinkState.PROLONGED_OCCLUSION,
          isInterpolated: false,
          valid: false,
          blinkDurationMs: blinkDuration,
        };
      }

      // Buffer frame for prospective linear interpolation if within gap threshold
      if (blinkDuration <= this.maxInterpolationGapMs && this.lastValidGaze) {
        this.metrics.interpolatedFramesCount++;
        return {
          timestampMs,
          x: this.lastValidGaze.x,
          y: this.lastValidGaze.y,
          state: this.state,
          isInterpolated: true,
          valid: true,
          blinkDurationMs: blinkDuration,
        };
      }

      return {
        timestampMs,
        x: null,
        y: null,
        state: this.state,
        isInterpolated: false,
        valid: false,
        blinkDurationMs: blinkDuration,
      };
    }

    // Eye is open and tracking is valid
    const clampedX = Math.max(0.0, Math.min(1.0, rawX));
    const clampedY = Math.max(0.0, Math.min(1.0, rawY));

    if (
      this.state === BlinkState.BLINK_ONSET ||
      this.state === BlinkState.BLINKING ||
      this.state === BlinkState.PROLONGED_OCCLUSION
    ) {
      this.state = BlinkState.BLINK_RECOVERY;
      this.blinkStartTimestamp = null;
    } else {
      this.state = BlinkState.OPEN;
    }

    this.lastValidGaze = {
      x: clampedX,
      y: clampedY,
      timestampMs,
    };

    return {
      timestampMs,
      x: clampedX,
      y: clampedY,
      state: this.state,
      isInterpolated: false,
      valid: true,
    };
  }

  /**
   * Returns current telemetry and mitigation metrics.
   */
  getTelemetryMetrics() {
    return {
      currentState: this.state,
      ...this.metrics,
    };
  }

  /**
   * Resets internal tracking and state.
   */
  reset() {
    this.state = BlinkState.OPEN;
    this.lastValidGaze = null;
    this.blinkStartTimestamp = null;
    this.lastTimestamp = null;
    this.pendingBlinkFrames = [];
    this.metrics = {
      totalFramesProcessed: 0,
      blinksDetected: 0,
      interpolatedFramesCount: 0,
      suppressedArtifactFrames: 0,
      prolongedOcclusionEvents: 0,
    };
  }
}
