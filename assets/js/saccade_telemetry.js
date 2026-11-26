/**
 * NeuroMirror - Saccade Latency & Visual Dispersion Telemetry Rotary.
 *
 * Tracks ocular saccade reaction times, visual fixation dispersion,
 * peak saccadic velocities, and cognitive fatigue states across sliding windows.
 */

export const ATTENTION_STATES = Object.freeze({
  OPTIMAL: 'OPTIMAL',
  FATIGUED: 'FATIGUED',
  DISTRACTED: 'DISTRACTED',
  IMPAIRED: 'IMPAIRED',
});

export class SaccadeTelemetryRotary {
  constructor(options = {}) {
    this.bufferCapacity = options.bufferCapacity ?? 1000;
    this.fatigueLatencyThresholdMs = options.fatigueLatencyThresholdMs ?? 320.0;
    this.impairmentLatencyThresholdMs = options.impairmentLatencyThresholdMs ?? 450.0;
    this.dispersionSpreadThresholdPx = options.dispersionSpreadThresholdPx ?? 120.0;

    this._saccades = [];
    this._fixations = [];
    this._totalSaccadesRecorded = 0;
  }

  /**
   * Ingests a detected saccade event.
   */
  recordSaccade({
    stimulusTimestamp,
    onsetTimestamp,
    startPos, // { x, y }
    endPos,   // { x, y }
    peakVelocityDegPerSec = null,
  }) {
    if (typeof stimulusTimestamp !== 'number' || typeof onsetTimestamp !== 'number') {
      throw new TypeError('Timestamps must be numeric milliseconds');
    }

    if (onsetTimestamp < stimulusTimestamp) {
      throw new RangeError('onsetTimestamp cannot precede stimulusTimestamp');
    }

    if (!startPos || !endPos || typeof startPos.x !== 'number' || typeof endPos.x !== 'number') {
      throw new TypeError('startPos and endPos must be objects with numeric x and y');
    }

    const latencyMs = onsetTimestamp - stimulusTimestamp;
    const dx = endPos.x - startPos.x;
    const dy = endPos.y - startPos.y;
    const amplitudePx = Math.sqrt(dx * dx + dy * dy);

    const event = {
      timestamp: onsetTimestamp,
      latencyMs: Number(latencyMs.toFixed(2)),
      amplitudePx: Number(amplitudePx.toFixed(2)),
      startPos: { x: startPos.x, y: startPos.y },
      endPos: { x: endPos.x, y: endPos.y },
      peakVelocityDegPerSec: peakVelocityDegPerSec !== null ? Number(peakVelocityDegPerSec.toFixed(2)) : null,
    };

    this._saccades.push(event);
    this._totalSaccadesRecorded += 1;

    if (this._saccades.length > this.bufferCapacity) {
      this._saccades.shift();
    }

    return event;
  }

  /**
   * Ingests a fixation event for visual spatial dispersion calculation.
   */
  recordFixation({ timestamp, x, y, durationMs = 100 }) {
    if (typeof timestamp !== 'number' || typeof x !== 'number' || typeof y !== 'number') {
      throw new TypeError('Invalid fixation arguments');
    }

    const fix = { timestamp, x, y, durationMs };
    this._fixations.push(fix);

    if (this._fixations.length > this.bufferCapacity) {
      this._fixations.shift();
    }

    return fix;
  }

  /**
   * Computes latency distribution statistics across recorded saccades.
   */
  computeLatencyStats(windowMs = null, now = Date.now()) {
    let pool = this._saccades;
    if (windowMs !== null && windowMs > 0) {
      const cutoff = now - windowMs;
      pool = pool.filter((s) => s.timestamp >= cutoff);
    }

    if (pool.length === 0) {
      return {
        sampleCount: 0,
        minMs: 0.0,
        p50Ms: 0.0,
        p90Ms: 0.0,
        p99Ms: 0.0,
        maxMs: 0.0,
        meanMs: 0.0,
      };
    }

    const latencies = pool.map((s) => s.latencyMs).sort((a, b) => a - b);
    const n = latencies.length;

    const percentile = (p) => {
      const k = (n - 1) * (p / 100.0);
      const f = Math.floor(k);
      const c = Math.ceil(k);
      if (f === c) return latencies[k];
      return latencies[f] * (c - k) + latencies[c] * (k - f);
    };

    const sum = latencies.reduce((acc, v) => acc + v, 0);

    return {
      sampleCount: n,
      minMs: Number(latencies[0].toFixed(2)),
      p50Ms: Number(percentile(50.0).toFixed(2)),
      p90Ms: Number(percentile(90.0).toFixed(2)),
      p99Ms: Number(percentile(99.0).toFixed(2)),
      maxMs: Number(latencies[n - 1].toFixed(2)),
      meanMs: Number((sum / n).toFixed(2)),
    };
  }

  /**
   * Computes spatial dispersion (Bivariate Contour & Root Mean Square Distance).
   */
  computeVisualDispersion(windowMs = null, now = Date.now()) {
    let pool = this._fixations;
    if (windowMs !== null && windowMs > 0) {
      const cutoff = now - windowMs;
      pool = pool.filter((f) => f.timestamp >= cutoff);
    }

    if (pool.length === 0) {
      return {
        sampleCount: 0,
        centroidX: 0.0,
        centroidY: 0.0,
        dispersionRadiusPx: 0.0,
        bceaAreaPx2: 0.0,
      };
    }

    const n = pool.length;
    let sumX = 0;
    let sumY = 0;
    for (const f of pool) {
      sumX += f.x;
      sumY += f.y;
    }
    const cx = sumX / n;
    const cy = sumY / n;

    let sumDistSq = 0;
    let varX = 0;
    let varY = 0;
    let covXY = 0;

    for (const f of pool) {
      const dx = f.x - cx;
      const dy = f.y - cy;
      sumDistSq += dx * dx + dy * dy;
      varX += dx * dx;
      varY += dy * dy;
      covXY += dx * dy;
    }

    varX /= n;
    varY /= n;
    covXY /= n;

    const rmsDist = Math.sqrt(sumDistSq / n);
    // Bivariate Contour Ellipse Area (BCEA) approximation: 2 * k * pi * sigmaX * sigmaY * sqrt(1 - rho^2)
    const det = Math.max(0.001, varX * varY - covXY * covXY);
    const bcea = 2 * Math.PI * Math.sqrt(det);

    return {
      sampleCount: n,
      centroidX: Number(cx.toFixed(2)),
      centroidY: Number(cy.toFixed(2)),
      dispersionRadiusPx: Number(rmsDist.toFixed(2)),
      bceaAreaPx2: Number(bcea.toFixed(2)),
    };
  }

  /**
   * Classifies cognitive attention state from latency and dispersion metrics.
   */
  evaluateAttentionState(windowMs = 30000, now = Date.now()) {
    const lat = this.computeLatencyStats(windowMs, now);
    const disp = this.computeVisualDispersion(windowMs, now);

    if (lat.sampleCount < 2) {
      return ATTENTION_STATES.OPTIMAL;
    }

    if (lat.p50Ms >= this.impairmentLatencyThresholdMs) {
      return ATTENTION_STATES.IMPAIRED;
    }

    if (lat.p50Ms >= this.fatigueLatencyThresholdMs) {
      return ATTENTION_STATES.FATIGUED;
    }

    if (disp.dispersionRadiusPx >= this.dispersionSpreadThresholdPx) {
      return ATTENTION_STATES.DISTRACTED;
    }

    return ATTENTION_STATES.OPTIMAL;
  }

  /**
   * Formats a markdown telemetry report.
   */
  formatMarkdownReport(now = Date.now()) {
    const lat = this.computeLatencyStats(null, now);
    const disp = this.computeVisualDispersion(null, now);
    const state = this.evaluateAttentionState(60000, now);

    return [
      '# Ocular Saccade & Visual Dispersion Rotary Telemetry',
      '',
      `**Attention State**: \`${state}\` | **Total Recorded**: ${this._totalSaccadesRecorded}`,
      '',
      '### Saccade Latency Percentiles (ms)',
      '| Samples | Min | P50 (Median) | P90 | P99 | Max | Mean |',
      '| :--- | :--- | :--- | :--- | :--- | :--- | :--- |',
      `| ${lat.sampleCount} | ${lat.minMs} ms | ${lat.p50Ms} ms | ${lat.p90Ms} ms | ${lat.p99Ms} ms | ${lat.maxMs} ms | ${lat.meanMs} ms |`,
      '',
      '### Fixation Spatial Dispersion',
      '| Fixations | Centroid (X, Y) | RMS Radius | BCEA Area |',
      '| :--- | :--- | :--- | :--- |',
      `| ${disp.sampleCount} | (${disp.centroidX}, ${disp.centroidY}) | ${disp.dispersionRadiusPx} px | ${disp.bceaAreaPx2} px² |`,
    ].join('\n');
  }
}
