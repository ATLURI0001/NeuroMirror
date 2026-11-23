/**
 * @file calibration_matrix_contract.js
 * Eye-Tracking Calibration Matrix Ingress Contract & Fixation Grid Sanitizer.
 *
 * Enforces strict boundary verification on spatial calibration target grids,
 * screen resolution matrices, fixation dwell samples, and statistical dispersion gates.
 */

const ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const SUPPORTED_LAYOUTS = new Set(['3x3', '4x4', '5-point', '9-point', 'custom']);

/**
 * Validates and sanitizes a complete calibration session manifest.
 *
 * @param {object} manifest - Ingress calibration grid manifest
 * @param {object} [options] - Validation parameters
 * @returns {{ valid: boolean, errors: string[], sanitizedManifest?: object }}
 */
export function validateAndSanitizeCalibrationManifest(manifest, options = {}) {
  const errors = [];

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: ['Manifest must be a non-null object'] };
  }

  // 1. Grid identifier & layout
  const gridId = String(manifest.gridId || '').trim();
  if (!ID_REGEX.test(gridId)) {
    errors.push(`Invalid gridId "${manifest.gridId}": must match ^[a-zA-Z0-9_-]{1,64}$`);
  }

  const layout = String(manifest.layout || 'custom').trim().toLowerCase();
  if (!SUPPORTED_LAYOUTS.has(layout)) {
    errors.push(`Unsupported layout "${manifest.layout}": must be one of ${Array.from(SUPPORTED_LAYOUTS).join(', ')}`);
  }

  // 2. Screen resolution boundary check
  const screen = manifest.screenResolution;
  if (!screen || typeof screen !== 'object') {
    errors.push('screenResolution must be an object with widthPx and heightPx');
  } else {
    const widthPx = Number(screen.widthPx);
    const heightPx = Number(screen.heightPx);
    if (!Number.isInteger(widthPx) || widthPx < 320 || widthPx > 15360) {
      errors.push(`Invalid screen widthPx (${screen.widthPx}): must be integer in [320, 15360]`);
    }
    if (!Number.isInteger(heightPx) || heightPx < 240 || heightPx > 8640) {
      errors.push(`Invalid screen heightPx (${screen.heightPx}): must be integer in [240, 8640]`);
    }
  }

  // 3. Points array validation
  const rawPoints = manifest.points;
  if (!Array.isArray(rawPoints) || rawPoints.length < 5) {
    errors.push(`Calibration points must be an array of at least 5 targets (received ${Array.isArray(rawPoints) ? rawPoints.length : 'non-array'})`);
    return { valid: false, errors };
  }

  const sanitizedPoints = [];
  const seenPointIds = new Set();
  let minX = 1.0;
  let maxX = 0.0;
  let minY = 1.0;
  let maxY = 0.0;

  const minSamplesPerPoint = options.minSamplesPerPoint || 3;
  const maxDispersionPx = options.maxDispersionPx || 120.0;
  const width = screen ? Number(screen.widthPx) : 1920;
  const height = screen ? Number(screen.heightPx) : 1080;

  for (let idx = 0; idx < rawPoints.length; idx++) {
    const pt = rawPoints[idx];
    if (!pt || typeof pt !== 'object') {
      errors.push(`Point at index ${idx} must be a non-null object`);
      continue;
    }

    const pointId = String(pt.pointId || `pt-${idx}`).trim();
    if (seenPointIds.has(pointId)) {
      errors.push(`Duplicate pointId "${pointId}" at index ${idx}`);
    }
    seenPointIds.add(pointId);

    // Target coordinates in normalized screen space [0, 1]
    const targetX = Number(pt.targetX ?? pt.targetNormalized?.x);
    const targetY = Number(pt.targetY ?? pt.targetNormalized?.y);

    if (!Number.isFinite(targetX) || targetX < 0.0 || targetX > 1.0) {
      errors.push(`Point "${pointId}": targetX (${targetX}) must be a finite float in [0.0, 1.0]`);
    }
    if (!Number.isFinite(targetY) || targetY < 0.0 || targetY > 1.0) {
      errors.push(`Point "${pointId}": targetY (${targetY}) must be a finite float in [0.0, 1.0]`);
    }

    if (Number.isFinite(targetX)) {
      minX = Math.min(minX, targetX);
      maxX = Math.max(maxX, targetX);
    }
    if (Number.isFinite(targetY)) {
      minY = Math.min(minY, targetY);
      maxY = Math.max(maxY, targetY);
    }

    // Process raw fixation samples
    const rawSamples = Array.isArray(pt.samples) ? pt.samples : [];
    const validSamples = [];

    for (let sIdx = 0; sIdx < rawSamples.length; sIdx++) {
      const s = rawSamples[sIdx];
      if (!s || typeof s !== 'object') continue;

      const gx = Number(s.gazeX ?? s.x);
      const gy = Number(s.gazeY ?? s.y);
      const conf = Number(s.confidence ?? 1.0);
      const pupilMm = Number(s.pupilDiameterMm ?? 3.5);

      // Filter invalid coordinates, low confidence (<0.5), or blink artifacts (pupil < 1.5mm)
      if (
        Number.isFinite(gx) &&
        Number.isFinite(gy) &&
        conf >= 0.5 &&
        pupilMm >= 1.5 &&
        pupilMm <= 9.0
      ) {
        validSamples.push({
          x: Math.max(0.0, Math.min(1.0, gx)),
          y: Math.max(0.0, Math.min(1.0, gy)),
          confidence: conf,
          pupilDiameterMm: pupilMm,
        });
      }
    }

    if (validSamples.length < minSamplesPerPoint) {
      errors.push(`Point "${pointId}": insufficient valid fixation samples (${validSamples.length} < ${minSamplesPerPoint})`);
      continue;
    }

    // Compute sample cluster centroid and spatial dispersion (standard deviation in pixels)
    let sumX = 0;
    let sumY = 0;
    for (const s of validSamples) {
      sumX += s.x;
      sumY += s.y;
    }
    const meanX = sumX / validSamples.length;
    const meanY = sumY / validSamples.length;

    let varPx = 0;
    for (const s of validSamples) {
      const dxPx = (s.x - meanX) * width;
      const dyPx = (s.y - meanY) * height;
      varPx += dxPx * dxPx + dyPx * dyPx;
    }
    const dispersionPx = Math.sqrt(varPx / validSamples.length);

    if (dispersionPx > maxDispersionPx) {
      errors.push(`Point "${pointId}": excessive gaze cluster dispersion (${dispersionPx.toFixed(1)}px > ${maxDispersionPx}px)`);
    }

    sanitizedPoints.push({
      pointId,
      targetNormalized: {
        x: Number(targetX.toFixed(4)),
        y: Number(targetY.toFixed(4)),
      },
      targetPx: {
        x: Math.round(targetX * width),
        y: Math.round(targetY * height),
      },
      sampleCount: validSamples.length,
      measuredCentroid: {
        x: Number(meanX.toFixed(4)),
        y: Number(meanY.toFixed(4)),
      },
      dispersionPx: Number(dispersionPx.toFixed(2)),
      qualityGrade: dispersionPx < 30 ? 'OPTIMAL' : dispersionPx < 60 ? 'GOOD' : 'ACCEPTABLE',
    });
  }

  // 4. Spatial grid span validation (calibration grid must cover at least 40% of screen in X and Y)
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (spanX < 0.40) {
    errors.push(`Calibration grid X span (${(spanX * 100).toFixed(1)}%) is insufficient: must cover at least 40% of screen width`);
  }
  if (spanY < 0.40) {
    errors.push(`Calibration grid Y span (${(spanY * 100).toFixed(1)}%) is insufficient: must cover at least 40% of screen height`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    sanitizedManifest: {
      gridId,
      layout,
      screenResolution: {
        widthPx: Number(screen.widthPx),
        heightPx: Number(screen.heightPx),
      },
      pointCount: sanitizedPoints.length,
      points: sanitizedPoints,
      spatialCoverage: {
        spanX: Number(spanX.toFixed(4)),
        spanY: Number(spanY.toFixed(4)),
        minX: Number(minX.toFixed(4)),
        maxX: Number(maxX.toFixed(4)),
        minY: Number(minY.toFixed(4)),
        maxY: Number(maxY.toFixed(4)),
      },
      calibratedAt: manifest.calibratedAt || new Date().toISOString(),
    },
  };
}
