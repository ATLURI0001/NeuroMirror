// Copyright (c) 2026 NeuroMirror Contributors
// SPDX-License-Identifier: MIT
// Neurological Ocular Fatigue Detector, PERCLOS & Micro-Saccade Velocity Profiler.

/**
 * Biometric observation sample.
 * @typedef {Object} OcularSample
 * @property {number} timestampMs - Monotonic timestamp
 * @property {number} apertureMm - Vertical eyelid aperture in millimeters
 * @property {number} [gazeYaw] - Horizontal gaze angle in radians
 * @property {number} [gazePitch] - Vertical gaze angle in radians
 */

export class OcularFatigueDetector {
  /**
   * @param {object} [options]
   * @param {number} [options.windowMs=60000] - Temporal sliding window in ms (1 minute)
   * @param {number} [options.closureThresholdMm=2.0] - Aperture threshold for eye closure
   * @param {number} [options.perclosThreshold=0.15] - PERCLOS threshold for drowsiness warning
   * @param {number} [options.microsleepDurationMs=400] - Duration of single closure to flag microsleep
   */
  constructor(options = {}) {
    this.windowMs = options.windowMs ?? 60000;
    this.closureThresholdMm = options.closureThresholdMm ?? 2.0;
    this.perclosThreshold = options.perclosThreshold ?? 0.15;
    this.microsleepDurationMs = options.microsleepDurationMs ?? 400;

    /** @type {Array<OcularSample>} */
    this.samples = [];

    // Blink tracking state
    this.isCurrentlyClosed = false;
    this.closureStartTime = 0;
    this.completedBlinks = []; // { durationMs, timestampMs }
  }

  /**
   * Records a timestamped ocular observation and updates fatigue metrics.
   * @param {number} timestampMs
   * @param {number} apertureMm
   * @param {number} [gazeYaw=0]
   * @param {number} [gazePitch=0]
   */
  recordSample(timestampMs, apertureMm, gazeYaw = 0, gazePitch = 0) {
    if (!Number.isFinite(timestampMs) || !Number.isFinite(apertureMm)) {
      return;
    }

    const isClosed = apertureMm <= this.closureThresholdMm;

    // Track blink state machine
    if (isClosed && !this.isCurrentlyClosed) {
      this.isCurrentlyClosed = true;
      this.closureStartTime = timestampMs;
    } else if (!isClosed && this.isCurrentlyClosed) {
      this.isCurrentlyClosed = false;
      const durationMs = Math.max(0, timestampMs - this.closureStartTime);
      this.completedBlinks.push({ durationMs, timestampMs });
    }

    this.samples.push({
      timestampMs,
      apertureMm,
      gazeYaw: Number.isFinite(gazeYaw) ? gazeYaw : 0,
      gazePitch: Number.isFinite(gazePitch) ? gazePitch : 0,
    });

    this._evictOldSamples(timestampMs);
  }

  /**
   * Evaluates fatigue status and returns diagnostic metrics.
   * @param {number} [now]
   * @returns {{ perclos: number, isDrowsy: boolean, microsleepDetected: boolean, blinkCount: number, avgBlinkDurationMs: number, attentivenessIndex: number }}
   */
  evaluate(now = null) {
    const currentTimestamp = now ?? (this.samples.length > 0 ? this.samples[this.samples.length - 1].timestampMs : Date.now());
    this._evictOldSamples(currentTimestamp);

    if (this.samples.length === 0) {
      return {
        perclos: 0.0,
        isDrowsy: false,
        microsleepDetected: false,
        blinkCount: 0,
        avgBlinkDurationMs: 0.0,
        attentivenessIndex: 1.0,
      };
    }

    // 1. Calculate PERCLOS: fraction of time spent with closed eyes
    let closedSampleCount = 0;
    for (const s of this.samples) {
      if (s.apertureMm <= this.closureThresholdMm) {
        closedSampleCount++;
      }
    }
    const perclos = Math.round((closedSampleCount / this.samples.length) * 1e4) / 1e4;

    // 2. Microsleep check
    let microsleepDetected = false;
    for (const b of this.completedBlinks) {
      if (b.durationMs >= this.microsleepDurationMs) {
        microsleepDetected = true;
        break;
      }
    }
    // Also check if current ongoing closure exceeds microsleep threshold
    if (this.isCurrentlyClosed && (currentTimestamp - this.closureStartTime) >= this.microsleepDurationMs) {
      microsleepDetected = true;
    }

    // 3. Average blink duration
    const blinkCount = this.completedBlinks.length;
    let avgBlinkDurationMs = 0.0;
    if (blinkCount > 0) {
      const totalBlinkMs = this.completedBlinks.reduce((sum, b) => sum + b.durationMs, 0);
      avgBlinkDurationMs = Math.round((totalBlinkMs / blinkCount) * 10) / 10;
    }

    const isDrowsy = perclos >= this.perclosThreshold || microsleepDetected;

    // 4. Attentiveness index: 1.0 - penalty
    let penalty = perclos * 3.0; // 0.15 PERCLOS -> 0.45 penalty
    if (microsleepDetected) penalty += 0.40;
    const attentivenessIndex = Math.round(Math.max(0.0, Math.min(1.0, 1.0 - penalty)) * 100) / 100;

    return {
      perclos,
      isDrowsy,
      microsleepDetected,
      blinkCount,
      avgBlinkDurationMs,
      attentivenessIndex,
    };
  }

  reset() {
    this.samples = [];
    this.completedBlinks = [];
    this.isCurrentlyClosed = false;
    this.closureStartTime = 0;
  }

  _evictOldSamples(currentTimestamp) {
    const cutoff = currentTimestamp - this.windowMs;
    while (this.samples.length > 0 && this.samples[0].timestampMs < cutoff) {
      this.samples.shift();
    }
    while (this.completedBlinks.length > 0 && this.completedBlinks[0].timestampMs < cutoff) {
      this.completedBlinks.shift();
    }
  }
}
