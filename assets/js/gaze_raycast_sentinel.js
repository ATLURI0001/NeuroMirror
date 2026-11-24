// Copyright (c) 2026 NeuroMirror Contributors
// SPDX-License-Identifier: MIT
//
// Eye-Tracking Gaze Raycasting NaN / Infinite Coordinate Failsafe Sentinel.
// Defends biometric gaze tracking against non-finite ray vectors, division-by-zero
// plane intersections, grazing parallel rays, and UI coordinate poisoning.

export const RaycastStatus = Object.freeze({
  VALID: 'VALID',
  NAN_COORDINATE_INTERCEPTED: 'NAN_COORDINATE_INTERCEPTED',
  PARALLEL_RAY_INTERCEPTED: 'PARALLEL_RAY_INTERCEPTED',
  BACKWARD_RAY_INTERCEPTED: 'BACKWARD_RAY_INTERCEPTED',
  CONFIDENCE_TOO_LOW: 'CONFIDENCE_TOO_LOW',
  DISCONTINUOUS_LEAP: 'DISCONTINUOUS_LEAP',
});

export class GazeRaycastSentinel {
  /**
   * @param {Object} [options]
   * @param {number} [options.screenWidth=1920] Display width in pixels
   * @param {number} [options.screenHeight=1080] Display height in pixels
   * @param {number} [options.minConfidence=0.30] Minimum tracking confidence threshold
   * @param {number} [options.planeDistanceMm=600] Distance from eye origin to screen plane in mm
   * @param {number} [options.holdLastKnownMs=500] Maximum duration to coast on last valid point
   */
  constructor(options = {}) {
    this.screenWidth = Math.max(320, Number(options.screenWidth) || 1920);
    this.screenHeight = Math.max(240, Number(options.screenHeight) || 1080);
    this.minConfidence = Math.max(0.0, Math.min(1.0, Number(options.minConfidence) || 0.30));
    this.planeDistanceMm = Math.max(100, Number(options.planeDistanceMm) || 600);
    this.holdLastKnownMs = Math.max(50, Number(options.holdLastKnownMs) || 500);

    // Default center anchor point
    this.defaultCenter = [this.screenWidth / 2, this.screenHeight / 2];

    this.lastValidPoint = null; // { x, y, timestampMs }
    this.incidents = [];

    this.metrics = {
      totalRaycastsEvaluated: 0,
      validRaycasts: 0,
      nanIncidentsBlocked: 0,
      parallelRaysBlocked: 0,
      backwardRaysBlocked: 0,
      lowConfidenceDropped: 0,
      fallbacksApplied: 0,
    };
  }

  /**
   * Evaluates, sanitizes, and projects a 3D gaze ray onto the 2D display plane.
   *
   * @param {Array<number>} origin - [x, y, z] eye pupil/cornea origin in mm
   * @param {Array<number>} direction - [dx, dy, dz] normalized gaze vector
   * @param {number} [confidence=1.0] - Measurement confidence score in [0.0, 1.0]
   * @param {number} [timestampMs] - Measurement timestamp in ms
   * @returns {Object} Sanitized projection outcome
   */
  sanitizeRaycast(origin, direction, confidence = 1.0, timestampMs = Date.now()) {
    this.metrics.totalRaycastsEvaluated++;
    const now = Number(timestampMs) || Date.now();
    const conf = Math.max(0.0, Math.min(1.0, Number(confidence) || 0.0));

    // 1. Non-finite / NaN coordinate check on origin and direction
    if (!this._isFiniteVec3(origin) || !this._isFiniteVec3(direction)) {
      this.metrics.nanIncidentsBlocked++;
      this._recordIncident('NON_FINITE_COORDINATE', { origin, direction }, now);
      return this._applyFallback(RaycastStatus.NAN_COORDINATE_INTERCEPTED, now);
    }

    // 2. Vector Magnitude Check (prevent zero division)
    const dx = direction[0];
    const dy = direction[1];
    const dz = direction[2];
    const magSq = dx * dx + dy * dy + dz * dz;

    if (magSq < 1e-12 || !Number.isFinite(magSq)) {
      this.metrics.nanIncidentsBlocked++;
      this._recordIncident('ZERO_MAGNITUDE_RAY', { direction }, now);
      return this._applyFallback(RaycastStatus.NAN_COORDINATE_INTERCEPTED, now);
    }

    // 3. Minimum Confidence Gating
    if (conf < this.minConfidence) {
      this.metrics.lowConfidenceDropped++;
      return this._applyFallback(RaycastStatus.CONFIDENCE_TOO_LOW, now);
    }

    // 4. Backward Ray Check (dz <= 0 indicates ray pointing away from screen)
    if (dz <= 0) {
      this.metrics.backwardRaysBlocked++;
      this._recordIncident('BACKWARD_RAY', { direction }, now);
      return this._applyFallback(RaycastStatus.BACKWARD_RAY_INTERCEPTED, now);
    }

    // 5. Near-Parallel Grazing Ray Check (dz approaching zero)
    if (dz < 1e-4) {
      this.metrics.parallelRaysBlocked++;
      this._recordIncident('PARALLEL_GRAZING_RAY', { direction }, now);
      return this._applyFallback(RaycastStatus.PARALLEL_RAY_INTERCEPTED, now);
    }

    // 6. Compute Ray-Plane Intersection
    // Ray: P(t) = origin + t * direction
    // Plane: Z = planeDistanceMm
    const originZ = origin[2];
    const t = (this.planeDistanceMm - originZ) / dz;

    if (t < 0 || !Number.isFinite(t)) {
      this.metrics.nanIncidentsBlocked++;
      this._recordIncident('INVALID_INTERSECTION_T', { t, origin, direction }, now);
      return this._applyFallback(RaycastStatus.NAN_COORDINATE_INTERCEPTED, now);
    }

    // Hit coordinates in mm on screen plane
    const hitX_mm = origin[0] + t * dx;
    const hitY_mm = origin[1] + t * dy;

    if (!Number.isFinite(hitX_mm) || !Number.isFinite(hitY_mm)) {
      this.metrics.nanIncidentsBlocked++;
      this._recordIncident('NON_FINITE_HIT_COORDINATES', { hitX_mm, hitY_mm }, now);
      return this._applyFallback(RaycastStatus.NAN_COORDINATE_INTERCEPTED, now);
    }

    // 7. Map mm to Screen Pixels (assume 0,0 is center of screen, convert to [0, width] x [0, height])
    // Assume screen physical dimensions: approx 500mm x 280mm (typical 24" monitor)
    const screenWidthMm = 530.0;
    const screenHeightMm = 300.0;

    const normX = (hitX_mm + screenWidthMm / 2) / screenWidthMm;
    const normY = (screenHeightMm / 2 - hitY_mm) / screenHeightMm; // Invert Y for screen coords

    // Clamp normalized coordinates to [0, 1]
    const clampedNormX = Math.max(0.0, Math.min(1.0, normX));
    const clampedNormY = Math.max(0.0, Math.min(1.0, normY));

    const pixelX = Math.round(clampedNormX * this.screenWidth);
    const pixelY = Math.round(clampedNormY * this.screenHeight);

    // Update last valid gaze point
    this.lastValidPoint = { x: pixelX, y: pixelY, timestampMs: now };
    this.metrics.validRaycasts++;

    return {
      valid: true,
      x: pixelX,
      y: pixelY,
      normalizedX: clampedNormX,
      normalizedY: clampedNormY,
      fallbackUsed: false,
      status: RaycastStatus.VALID,
      confidence: conf,
      timestampMs: now,
    };
  }

  /**
   * Checks if an array has 3 valid finite numbers.
   */
  _isFiniteVec3(v) {
    return (
      Array.isArray(v) &&
      v.length >= 3 &&
      Number.isFinite(v[0]) &&
      Number.isFinite(v[1]) &&
      Number.isFinite(v[2])
    );
  }

  /**
   * Applies failsafe coasting or fallback to default anchor point.
   */
  _applyFallback(status, now) {
    this.metrics.fallbacksApplied++;

    // If last valid point exists and is within holdLastKnownMs, coast
    if (this.lastValidPoint && now - this.lastValidPoint.timestampMs <= this.holdLastKnownMs) {
      return {
        valid: false,
        x: this.lastValidPoint.x,
        y: this.lastValidPoint.y,
        normalizedX: this.lastValidPoint.x / this.screenWidth,
        normalizedY: this.lastValidPoint.y / this.screenHeight,
        fallbackUsed: true,
        fallbackType: 'COAST_LAST_VALID',
        status,
        timestampMs: now,
      };
    }

    // Otherwise, default to center anchor
    return {
      valid: false,
      x: this.defaultCenter[0],
      y: this.defaultCenter[1],
      normalizedX: 0.5,
      normalizedY: 0.5,
      fallbackUsed: true,
      fallbackType: 'DEFAULT_CENTER_ANCHOR',
      status,
      timestampMs: now,
    };
  }

  _recordIncident(cause, details, timestampMs) {
    this.incidents.push({
      incidentId: `GAZE-NAN-${timestampMs}-${this.incidents.length + 1}`,
      cause,
      details: JSON.stringify(details),
      timestampMs,
    });
    if (this.incidents.length > 100) {
      this.incidents.shift();
    }
  }

  getMetrics() {
    return { ...this.metrics };
  }

  getIncidents() {
    return [...this.incidents];
  }

  generatePostmortemReport() {
    if (this.incidents.length === 0) {
      return '# Incident Postmortem: No Raycast Anomalies Detected\n\nAll 3D gaze ray vectors conformed to finite geometric invariants.';
    }

    const lines = [
      '# Incident Postmortem: Eye-Tracking Gaze Raycasting NaN / Infinite Coordinate Report',
      '',
      `**Generated:** ${new Date().toISOString()}`,
      `**Total Raycasts Evaluated:** ${this.metrics.totalRaycastsEvaluated}`,
      `**Valid Raycasts:** ${this.metrics.validRaycasts}`,
      `**NaN / Non-Finite Incidents Blocked:** ${this.metrics.nanIncidentsBlocked}`,
      `**Parallel / Grazing Rays Blocked:** ${this.metrics.parallelRaysBlocked}`,
      `**Fallbacks Applied:** ${this.metrics.fallbacksApplied}`,
      '',
      '## Incident Log Table',
      '| Incident ID | Root Cause | Ray Details | Timestamp |',
      '|---|---|---|---|',
    ];

    for (const inc of this.incidents.slice(-10)) {
      lines.push(`| \`${inc.incidentId}\` | ${inc.cause} | \`${inc.details}\` | ${inc.timestampMs} |`);
    }

    return lines.join('\n');
  }

  reset() {
    this.lastValidPoint = null;
    this.incidents = [];
    this.metrics.totalRaycastsEvaluated = 0;
    this.metrics.validRaycasts = 0;
    this.metrics.nanIncidentsBlocked = 0;
    this.metrics.parallelRaysBlocked = 0;
    this.metrics.backwardRaysBlocked = 0;
    this.metrics.lowConfidenceDropped = 0;
    this.metrics.fallbacksApplied = 0;
  }
}
