'use strict';

/**
 * GazeTelemetryRotary & Visual Attention Diagnostic Engine for NeuroMirror
 * Computes spatial gaze dispersion, blink rate per minute, PERCLOS ratios,
 * and classifies real-time ocular tracking health.
 */

class GazeTelemetryRotary {
  /**
   * @param {Object} [options]
   * @param {number} [options.windowDurationMs=10000] Sliding window duration in milliseconds (default 10s)
   * @param {number} [options.minConfidenceThreshold=0.6] Low confidence boundary
   * @param {number} [options.optimalConfidenceThreshold=0.85] High tracking confidence boundary
   */
  constructor(options = {}) {
    this.windowDurationMs = Math.max(1000, Number(options.windowDurationMs) || 10000);
    this.minConfidenceThreshold = Number(options.minConfidenceThreshold) || 0.6;
    this.optimalConfidenceThreshold = Number(options.optimalConfidenceThreshold) || 0.85;

    this.reset();
  }

  reset() {
    this.frames = [];
    this.blinks = [];
    this.diagnostics = [];
    this.totalFramesReceived = 0;
  }

  /**
   * Records an eye-tracking sample.
   * @param {Object} frame
   * @param {number} frame.x Normalized screen X [0.0, 1.0]
   * @param {number} frame.y Normalized screen Y [0.0, 1.0]
   * @param {number} [frame.pupilMm=3.5] Pupil diameter in millimeters
   * @param {number} [frame.confidence=1.0] Tracking confidence [0.0, 1.0]
   * @param {boolean} [frame.isBlink=false] Whether frame is classified as a blink
   * @param {number} [timestamp=Date.now()] Timestamp in milliseconds
   */
  recordFrame(frame, timestamp = Date.now()) {
    this.totalFramesReceived++;

    const x = Math.max(0.0, Math.min(1.0, Number(frame.x) || 0.0));
    const y = Math.max(0.0, Math.min(1.0, Number(frame.y) || 0.0));
    const pupilMm = Math.max(1.0, Math.min(10.0, Number(frame.pupilMm) || 3.5));
    const confidence = Math.max(0.0, Math.min(1.0, Number(frame.confidence) ?? 1.0));
    const isBlink = Boolean(frame.isBlink);

    const sample = { x, y, pupilMm, confidence, isBlink, timestamp };
    this.frames.push(sample);

    if (isBlink) {
      this.blinks.push(timestamp);
    }

    this._evictOld(timestamp);
  }

  _evictOld(currentTimestamp) {
    const cutoff = currentTimestamp - this.windowDurationMs;
    while (this.frames.length > 0 && this.frames[0].timestamp < cutoff) {
      this.frames.shift();
    }
    while (this.blinks.length > 0 && this.blinks[0] < cutoff) {
      this.blinks.shift();
    }
  }

  /**
   * Computes spatial dispersion (radial standard deviation) of fixation point.
   * @returns {number} Dispersion radius in normalized screen units
   */
  computeSpatialDispersion() {
    const nonBlinkFrames = this.frames.filter((f) => !f.isBlink && f.confidence >= this.minConfidenceThreshold);
    if (nonBlinkFrames.length < 2) return 0.0;

    const n = nonBlinkFrames.length;
    const meanX = nonBlinkFrames.reduce((acc, f) => acc + f.x, 0) / n;
    const meanY = nonBlinkFrames.reduce((acc, f) => acc + f.y, 0) / n;

    const varX = nonBlinkFrames.reduce((acc, f) => acc + (f.x - meanX) ** 2, 0) / (n - 1);
    const varY = nonBlinkFrames.reduce((acc, f) => acc + (f.y - meanY) ** 2, 0) / (n - 1);

    return Number(Math.sqrt(varX + varY).toFixed(4));
  }

  /**
   * Computes PERCLOS (Percentage of Eye Closure over window).
   * @returns {number} Ratio [0.0, 1.0]
   */
  computePERCLOS() {
    if (this.frames.length === 0) return 0.0;
    const blinkCount = this.frames.filter((f) => f.isBlink).length;
    return Number((blinkCount / this.frames.length).toFixed(4));
  }

  /**
   * Computes extrapolated blink rate per minute.
   * @returns {number}
   */
  computeBlinkRatePerMinute() {
    if (this.frames.length < 2) return 0.0;
    const durationSec = (this.frames[this.frames.length - 1].timestamp - this.frames[0].timestamp) / 1000;
    if (durationSec <= 0.5) return 0.0;

    const rate = (this.blinks.length / durationSec) * 60;
    return Number(rate.toFixed(1));
  }

  /**
   * Mean tracking confidence across current window.
   * @returns {number}
   */
  computeMeanConfidence() {
    if (this.frames.length === 0) return 0.0;
    const sum = this.frames.reduce((acc, f) => acc + f.confidence, 0);
    return Number((sum / this.frames.length).toFixed(4));
  }

  /**
   * Evaluates tracking health and returns diagnostic classification.
   * @returns {{
   *   status: 'OPTIMAL' | 'DEGRADED' | 'UNRELIABLE',
   *   meanConfidence: number,
   *   perclos: number,
   *   blinkRatePerMin: number,
   *   spatialDispersion: number,
   *   activeFrames: number,
   *   diagnostics: string[]
   * }}
   */
  evaluateDiagnostics() {
    const meanConf = this.computeMeanConfidence();
    const perclos = this.computePERCLOS();
    const blinkRate = this.computeBlinkRatePerMinute();
    const dispersion = this.computeSpatialDispersion();

    const diagnostics = [];
    let status = 'OPTIMAL';

    if (meanConf < this.minConfidenceThreshold) {
      status = 'UNRELIABLE';
      diagnostics.push(`Tracking confidence critically low (${(meanConf * 100).toFixed(1)}%). Check lighting or camera positioning.`);
    } else if (meanConf < this.optimalConfidenceThreshold) {
      if (status !== 'UNRELIABLE') status = 'DEGRADED';
      diagnostics.push(`Tracking confidence degraded (${(meanConf * 100).toFixed(1)}%).`);
    }

    if (perclos > 0.40) {
      status = 'UNRELIABLE';
      diagnostics.push(`High eye closure ratio (${(perclos * 100).toFixed(1)}%). Probable ocular fatigue or sensor occlusion.`);
    } else if (perclos > 0.15) {
      if (status === 'OPTIMAL') status = 'DEGRADED';
      diagnostics.push(`Elevated eye closure ratio (${(perclos * 100).toFixed(1)}%). Drowsiness detected.`);
    }

    if (dispersion > 0.35) {
      if (status === 'OPTIMAL') status = 'DEGRADED';
      diagnostics.push(`High spatial dispersion (${dispersion}). Fixation instability or erratic scanning.`);
    }

    return {
      status,
      meanConfidence: meanConf,
      perclos,
      blinkRatePerMin: blinkRate,
      spatialDispersion: dispersion,
      activeFrames: this.frames.length,
      diagnostics,
    };
  }
}

module.exports = {
  GazeTelemetryRotary,
};
