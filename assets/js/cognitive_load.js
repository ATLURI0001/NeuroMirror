// Copyright (c) 2026 NeuroMirror Contributors
// SPDX-License-Identifier: MIT
// Pupil Diameter Dynamics & Cognitive Load Estimator (Task-Evoked Pupillary Response).

/**
 * @typedef {'LOW'|'NOMINAL'|'HIGH'|'OVERLOAD'} CognitiveLoadLevel
 */

export class CognitiveLoadEstimator {
  /**
   * @param {Object} [options]
   * @param {number} [options.windowMs=10000] - Sliding temporal evaluation window (10s)
   * @param {number} [options.baselineEmaAlpha=0.01] - Exponential moving average smoothing for baseline pupil size
   * @param {number} [options.minPupilMm=1.5] - Physiological lower bound (clamped/blink rejection)
   * @param {number} [options.maxPupilMm=8.5] - Physiological upper bound
   * @param {number} [options.highThresholdZ=1.2] - Normalized z-score threshold for HIGH mental load
   * @param {number} [options.overloadThresholdZ=2.2] - Normalized z-score threshold for OVERLOAD
   */
  constructor(options = {}) {
    this.windowMs = options.windowMs ?? 10000;
    this.baselineEmaAlpha = Math.min(Math.max(options.baselineEmaAlpha ?? 0.01, 0.001), 0.5);
    this.minPupilMm = options.minPupilMm ?? 1.5;
    this.maxPupilMm = options.maxPupilMm ?? 8.5;
    this.highThresholdZ = options.highThresholdZ ?? 1.2;
    this.overloadThresholdZ = options.overloadThresholdZ ?? 2.2;

    this.baselinePupilMm = 3.5; // Adaptive tonic baseline
    this.isCalibrated = false;

    // Sliding window of valid non-blink samples: { timestampMs, rawMm, tonicMm, phasicMm }
    this.history = [];

    this.telemetry = {
      totalSamples: 0,
      blinksFiltered: 0,
      currentLoadLevel: 'LOW',
      currentZScore: 0.0,
      meanPhasicDilationMm: 0.0,
    };
  }

  /**
   * Evaluates whether a pupil observation is a valid non-blink physiological sample
   * @param {number} pupilMm
   * @returns {boolean}
   */
  isValidObservation(pupilMm) {
    if (pupilMm === null || pupilMm === undefined || typeof pupilMm !== 'number' || isNaN(pupilMm)) {
      return false;
    }
    return pupilMm >= this.minPupilMm && pupilMm <= this.maxPupilMm;
  }

  /**
   * Records a timestamped pupil diameter measurement and updates cognitive load estimates.
   * @param {number} timestampMs
   * @param {number} pupilMm
   * @returns {{level: CognitiveLoadLevel, zScore: number, dilationMm: number, isBlink: boolean}}
   */
  recordSample(timestampMs, pupilMm) {
    this.telemetry.totalSamples++;

    if (!this.isValidObservation(pupilMm)) {
      this.telemetry.blinksFiltered++;
      return {
        level: this.telemetry.currentLoadLevel,
        zScore: this.telemetry.currentZScore,
        dilationMm: 0,
        isBlink: true,
      };
    }

    // Adaptive baseline calibration
    if (!this.isCalibrated) {
      this.baselinePupilMm = pupilMm;
      this.isCalibrated = true;
    } else {
      // Slow exponential smoothing adapts baseline to ambient luminance changes
      this.baselinePupilMm = (1 - this.baselineEmaAlpha) * this.baselinePupilMm + this.baselineEmaAlpha * pupilMm;
    }

    // Phasic (task-evoked) dilation component
    const phasicDilation = pupilMm - this.baselinePupilMm;

    this.history.push({
      timestampMs,
      rawMm: pupilMm,
      tonicMm: this.baselinePupilMm,
      phasicMm: phasicDilation,
    });

    // Evict old samples outside sliding window
    const cutoff = timestampMs - this.windowMs;
    while (this.history.length > 0 && this.history[0].timestampMs < cutoff) {
      this.history.shift();
    }

    // Compute sample mean and standard deviation of phasic dilations
    const phasicValues = this.history.map(s => s.phasicMm);
    const meanPhasic = phasicValues.reduce((sum, v) => sum + v, 0) / phasicValues.length;

    let variance = 0;
    if (phasicValues.length > 1) {
      variance = phasicValues.reduce((sum, v) => sum + Math.pow(v - meanPhasic, 2), 0) / (phasicValues.length - 1);
    }
    const stdDev = Math.sqrt(variance);

    // Z-score calculation: how many standard deviations above tonic baseline
    const referenceStd = Math.max(stdDev, 0.1); // Guard against zero division
    const zScore = (phasicDilation) / referenceStd;

    // Cognitive load level determination
    let level = 'LOW';
    if (zScore >= this.overloadThresholdZ) {
      level = 'OVERLOAD';
    } else if (zScore >= this.highThresholdZ) {
      level = 'HIGH';
    } else if (zScore >= 0.0) {
      level = 'NOMINAL';
    }

    this.telemetry.currentLoadLevel = level;
    this.telemetry.currentZScore = Math.round(zScore * 100) / 100;
    this.telemetry.meanPhasicDilationMm = Math.round(meanPhasic * 1000) / 1000;

    return {
      level,
      zScore: this.telemetry.currentZScore,
      dilationMm: Math.round(phasicDilation * 1000) / 1000,
      isBlink: false,
    };
  }

  getTelemetry() {
    return {
      ...this.telemetry,
      baselinePupilMm: Math.round(this.baselinePupilMm * 1000) / 1000,
      bufferedSampleCount: this.history.length,
    };
  }

  reset() {
    this.history = [];
    this.isCalibrated = false;
    this.baselinePupilMm = 3.5;
    this.telemetry = {
      totalSamples: 0,
      blinksFiltered: 0,
      currentLoadLevel: 'LOW',
      currentZScore: 0.0,
      meanPhasicDilationMm: 0.0,
    };
  }
}
