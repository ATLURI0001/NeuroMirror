/**
 * NeuroMirror: Saccadic Eye Movement Velocity Profiler & Fixation Drift Stabilizer
 * Classifies gaze trajectory into Fixations, Smooth Pursuits, and Saccades using
 * angular velocity thresholding with adaptive drift stabilization.
 */

export const GazeMovementType = {
  FIXATION: 'fixation',
  SMOOTH_PURSUIT: 'smooth_pursuit',
  SACCADE: 'saccade',
};

export class SaccadeProfiler {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.fixationVelocityThreshold=30.0] Max velocity in deg/s for fixation
   * @param {number} [options.saccadeVelocityThreshold=300.0] Min velocity in deg/s for saccade
   * @param {number} [options.driftAlpha=0.15] Smoothing factor for fixation stabilizer
   * @param {number} [options.pixelsPerDegree=35.0] Estimated display pixels per visual angle degree
   */
  constructor(options = {}) {
    this.fixationVelocityThreshold = Math.max(1.0, Number(options.fixationVelocityThreshold) || 30.0);
    this.saccadeVelocityThreshold = Math.max(
      this.fixationVelocityThreshold + 10.0,
      Number(options.saccadeVelocityThreshold) || 300.0
    );
    this.driftAlpha = Math.min(1.0, Math.max(0.01, Number(options.driftAlpha) || 0.15));
    this.pixelsPerDegree = Math.max(1.0, Number(options.pixelsPerDegree) || 35.0);

    // State tracking
    this.lastPoint = null;
    this.lastTimestampSec = null;
    this.stabilizedGaze = null;
    this.currentMovement = GazeMovementType.FIXATION;

    // Saccade metrics
    this.peakVelocityDegSec = 0.0;
    this.saccadeCount = 0;
    this.fixationCount = 0;
  }

  /**
   * Processes a raw 2D gaze sample (screen coordinates in pixels) and timestamp.
   * @param {number} x
   * @param {number} y
   * @param {number} timestampSec
   * @returns {Object} Profiling result with stabilized position, velocity, and classification
   */
  processSample(x, y, timestampSec) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(timestampSec)) {
      return {
        movementType: this.currentMovement,
        velocityDegSec: 0.0,
        stabilizedX: this.stabilizedGaze?.x ?? 0,
        stabilizedY: this.stabilizedGaze?.y ?? 0,
      };
    }

    if (this.lastPoint === null || this.lastTimestampSec === null) {
      this.lastPoint = { x, y };
      this.lastTimestampSec = timestampSec;
      this.stabilizedGaze = { x, y };
      return {
        movementType: GazeMovementType.FIXATION,
        velocityDegSec: 0.0,
        stabilizedX: x,
        stabilizedY: y,
      };
    }

    const dt = timestampSec - this.lastTimestampSec;
    if (dt <= 0.0001 || dt > 1.0) {
      // Discontinuous timestamp: reset anchor
      this.lastPoint = { x, y };
      this.lastTimestampSec = timestampSec;
      this.stabilizedGaze = { x, y };
      return {
        movementType: GazeMovementType.FIXATION,
        velocityDegSec: 0.0,
        stabilizedX: x,
        stabilizedY: y,
      };
    }

    // Euclidean pixel displacement
    const dx = x - this.lastPoint.x;
    const dy = y - this.lastPoint.y;
    const pixelDistance = Math.hypot(dx, dy);

    // Convert to visual angle degrees
    const degreesDisplacement = pixelDistance / this.pixelsPerDegree;
    const velocityDegSec = degreesDisplacement / dt;

    // Movement Classification
    let movementType = GazeMovementType.SMOOTH_PURSUIT;
    if (velocityDegSec < this.fixationVelocityThreshold) {
      movementType = GazeMovementType.FIXATION;
      this.fixationCount++;
      // Apply exponential smoothing to stabilize microsaccadic drift
      this.stabilizedGaze.x += this.driftAlpha * (x - this.stabilizedGaze.x);
      this.stabilizedGaze.y += this.driftAlpha * (y - this.stabilizedGaze.y);
    } else if (velocityDegSec >= this.saccadeVelocityThreshold) {
      movementType = GazeMovementType.SACCADE;
      if (this.currentMovement !== GazeMovementType.SACCADE) {
        this.saccadeCount++;
      }
      this.peakVelocityDegSec = Math.max(this.peakVelocityDegSec, velocityDegSec);
      // During ballistic saccades, follow raw gaze immediately without low-pass lag
      this.stabilizedGaze = { x, y };
    } else {
      // Smooth pursuit
      this.stabilizedGaze = { x, y };
    }

    this.currentMovement = movementType;
    this.lastPoint = { x, y };
    this.lastTimestampSec = timestampSec;

    return {
      movementType,
      velocityDegSec: Math.round(velocityDegSec * 10) / 10,
      stabilizedX: Math.round(this.stabilizedGaze.x * 10) / 10,
      stabilizedY: Math.round(this.stabilizedGaze.y * 10) / 10,
      peakVelocityDegSec: Math.round(this.peakVelocityDegSec * 10) / 10,
    };
  }

  reset() {
    this.lastPoint = null;
    this.lastTimestampSec = null;
    this.stabilizedGaze = null;
    this.currentMovement = GazeMovementType.FIXATION;
    this.peakVelocityDegSec = 0.0;
    this.saccadeCount = 0;
    this.fixationCount = 0;
  }
}
