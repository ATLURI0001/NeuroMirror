/**
 * NeuroMirror Ocular Fixation Drift Telemetry & Microsaccade Frequency Diagnostic
 * 
 * Provides real-time metrics collection, dispersion radius computation,
 * microsaccade burst detection, and oculomotor degradation diagnostics.
 */

export class FixationTelemetryCollector {
  constructor(options = {}) {
    this.maxWindowSize = options.maxWindowSize || 1000;
    this.driftThresholdPx = options.driftThresholdPx || 45.0;
    this.maxMicrosaccadeRateHz = options.maxMicrosaccadeRateHz || 4.5;
    this.minConfidence = options.minConfidence !== undefined ? options.minConfidence : 0.6;

    this.samples = [];
    this.fixations = [];
    this.microsaccades = [];
    this.activeFixation = null;
    this.totalSamplesProcessed = 0;
    this.lowConfidenceDrops = 0;
  }

  /**
   * Records a raw gaze sample: { x, y, timestamp, pupilDiameter, confidence }
   */
  recordSample(sample) {
    if (
      !sample ||
      typeof sample.x !== 'number' ||
      typeof sample.y !== 'number' ||
      typeof sample.timestamp !== 'number' ||
      !Number.isFinite(sample.x) ||
      !Number.isFinite(sample.y)
    ) {
      throw new Error('Invalid gaze sample: x, y, and timestamp must be finite numbers');
    }

    this.totalSamplesProcessed++;

    const conf = sample.confidence !== undefined ? sample.confidence : 1.0;
    if (conf < this.minConfidence) {
      this.lowConfidenceDrops++;
      return null;
    }

    const normalizedSample = {
      x: sample.x,
      y: sample.y,
      timestamp: sample.timestamp,
      pupilDiameter: sample.pupilDiameter || 3.0,
      confidence: conf,
    };

    this.samples.push(normalizedSample);
    if (this.samples.length > this.maxWindowSize) {
      this.samples.shift();
    }

    this._processSample(normalizedSample);
    return normalizedSample;
  }

  _processSample(sample) {
    if (!this.activeFixation) {
      this.activeFixation = {
        id: `fix-${this.fixations.length + 1}`,
        startTime: sample.timestamp,
        endTime: sample.timestamp,
        anchorX: sample.x,
        anchorY: sample.y,
        samples: [sample],
        totalDriftDistance: 0.0,
        maxDriftDistance: 0.0,
        microsaccadeCount: 0,
      };
      return;
    }

    const prevSample = this.activeFixation.samples[this.activeFixation.samples.length - 1];
    const dt = (sample.timestamp - prevSample.timestamp) / 1000.0; // in seconds
    const dx = sample.x - prevSample.x;
    const dy = sample.y - prevSample.y;
    const stepDist = Math.hypot(dx, dy);
    const stepVelocity = dt > 0 ? stepDist / dt : 0; // px/sec

    // Check drift from fixation anchor
    const driftFromAnchor = Math.hypot(sample.x - this.activeFixation.anchorX, sample.y - this.activeFixation.anchorY);

    // If step velocity is high and distance jumps beyond fixation threshold -> Saccade breaks fixation
    if (driftFromAnchor > this.driftThresholdPx && stepVelocity > 250.0) {
      this._closeActiveFixation(sample.timestamp);
      this.activeFixation = {
        id: `fix-${this.fixations.length + 1}`,
        startTime: sample.timestamp,
        endTime: sample.timestamp,
        anchorX: sample.x,
        anchorY: sample.y,
        samples: [sample],
        totalDriftDistance: 0.0,
        maxDriftDistance: 0.0,
        microsaccadeCount: 0,
      };
      return;
    }

    // Detect microsaccade: rapid transient micro-shift during fixation (velocity 40..250 px/s, step 2..30 px)
    if (stepVelocity >= 40.0 && stepVelocity <= 250.0 && stepDist >= 2.0 && stepDist <= 30.0) {
      const msEvent = {
        fixationId: this.activeFixation.id,
        timestamp: sample.timestamp,
        amplitudePx: Math.round(stepDist * 100) / 100,
        velocityPxPerSec: Math.round(stepVelocity * 10) / 10,
      };
      this.microsaccades.push(msEvent);
      this.activeFixation.microsaccadeCount++;
    }

    this.activeFixation.samples.push(sample);
    this.activeFixation.endTime = sample.timestamp;
    this.activeFixation.totalDriftDistance += stepDist;
    if (driftFromAnchor > this.activeFixation.maxDriftDistance) {
      this.activeFixation.maxDriftDistance = driftFromAnchor;
    }
  }

  _closeActiveFixation(endTime) {
    if (!this.activeFixation) return;
    this.activeFixation.endTime = endTime;
    const durationMs = this.activeFixation.endTime - this.activeFixation.startTime;
    this.activeFixation.durationMs = durationMs;

    // Compute centroid
    const count = this.activeFixation.samples.length;
    const sumX = this.activeFixation.samples.reduce((acc, s) => acc + s.x, 0);
    const sumY = this.activeFixation.samples.reduce((acc, s) => acc + s.y, 0);
    this.activeFixation.centroidX = count > 0 ? sumX / count : this.activeFixation.anchorX;
    this.activeFixation.centroidY = count > 0 ? sumY / count : this.activeFixation.anchorY;

    // Compute standard deviation / dispersion radius (RMS)
    const varDist = this.activeFixation.samples.reduce((acc, s) => {
      return acc + Math.pow(Math.hypot(s.x - this.activeFixation.centroidX, s.y - this.activeFixation.centroidY), 2);
    }, 0);
    this.activeFixation.dispersionRadiusPx = count > 0 ? Math.sqrt(varDist / count) : 0.0;

    this.fixations.push(this.activeFixation);
  }

  /**
   * Finalizes any currently open fixation and computes aggregate telemetry.
   */
  getTelemetryReport() {
    if (this.activeFixation && this.activeFixation.samples.length > 1) {
      const lastTs = this.activeFixation.samples[this.activeFixation.samples.length - 1].timestamp;
      this._closeActiveFixation(lastTs);
      this.activeFixation = null;
    }

    const totalFixations = this.fixations.length;
    const totalMicrosaccades = this.microsaccades.length;

    let totalDurationMs = 0;
    let sumDispersion = 0;
    let sumMaxDrift = 0;

    for (const f of this.fixations) {
      totalDurationMs += f.durationMs || 0;
      sumDispersion += f.dispersionRadiusPx || 0;
      sumMaxDrift += f.maxDriftDistance || 0;
    }

    const meanDurationMs = totalFixations > 0 ? totalDurationMs / totalFixations : 0.0;
    const meanDispersionPx = totalFixations > 0 ? sumDispersion / totalFixations : 0.0;
    const meanMaxDriftPx = totalFixations > 0 ? sumMaxDrift / totalFixations : 0.0;

    const totalSeconds = totalDurationMs / 1000.0;
    const microsaccadeRateHz = totalSeconds > 0 ? totalMicrosaccades / totalSeconds : 0.0;

    // Diagnostic evaluations
    const warnings = [];
    let isDegraded = false;

    if (microsaccadeRateHz > this.maxMicrosaccadeRateHz) {
      warnings.push(`Elevated microsaccade frequency (${microsaccadeRateHz.toFixed(2)} Hz > ${this.maxMicrosaccadeRateHz} Hz limit)`);
      isDegraded = true;
    }

    if (meanDispersionPx > this.driftThresholdPx * 0.75) {
      warnings.push(`Excessive ocular drift dispersion (${meanDispersionPx.toFixed(2)} px > ${(this.driftThresholdPx * 0.75).toFixed(2)} px threshold)`);
      isDegraded = true;
    }

    const dropRate = this.totalSamplesProcessed > 0 ? this.lowConfidenceDrops / this.totalSamplesProcessed : 0;
    if (dropRate > 0.15) {
      warnings.push(`High low-confidence sample drop rate (${(dropRate * 100).toFixed(1)}%)`);
      isDegraded = true;
    }

    return {
      totalSamplesProcessed: this.totalSamplesProcessed,
      lowConfidenceDrops: this.lowConfidenceDrops,
      totalFixations,
      totalMicrosaccades,
      totalDurationMs: Math.round(totalDurationMs),
      meanDurationMs: Math.round(meanDurationMs * 10) / 10,
      meanDispersionRadiusPx: Math.round(meanDispersionPx * 100) / 100,
      meanMaxDriftPx: Math.round(meanMaxDriftPx * 100) / 100,
      microsaccadeRateHz: Math.round(microsaccadeRateHz * 100) / 100,
      isDegraded,
      warnings,
    };
  }

  /**
   * Exports Prometheus-compatible metrics text format.
   */
  toPrometheusMetrics() {
    const report = this.getTelemetryReport();
    return [
      `# HELP neuromirror_ocular_samples_total Total gaze samples processed`,
      `# TYPE neuromirror_ocular_samples_total counter`,
      `neuromirror_ocular_samples_total ${report.totalSamplesProcessed}`,
      `# HELP neuromirror_fixations_total Total completed fixations identified`,
      `# TYPE neuromirror_fixations_total counter`,
      `neuromirror_fixations_total ${report.totalFixations}`,
      `# HELP neuromirror_microsaccades_total Total microsaccade events detected`,
      `# TYPE neuromirror_microsaccades_total counter`,
      `neuromirror_microsaccades_total ${report.totalMicrosaccades}`,
      `# HELP neuromirror_fixation_mean_dispersion_px Mean fixation dispersion radius in pixels`,
      `# TYPE neuromirror_fixation_mean_dispersion_px gauge`,
      `neuromirror_fixation_mean_dispersion_px ${report.meanDispersionRadiusPx}`,
      `# HELP neuromirror_microsaccade_rate_hz Microsaccade rate in events per second`,
      `# TYPE neuromirror_microsaccade_rate_hz gauge`,
      `neuromirror_microsaccade_rate_hz ${report.microsaccadeRateHz}`,
      `# HELP neuromirror_oculomotor_degraded Binary indicator of oculomotor instability`,
      `# TYPE neuromirror_oculomotor_degraded gauge`,
      `neuromirror_oculomotor_degraded ${report.isDegraded ? 1 : 0}`,
    ].join('\n');
  }
}
