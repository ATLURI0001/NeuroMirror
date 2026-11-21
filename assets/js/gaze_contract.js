/**
 * Eye-Tracking Gaze Ingress Telemetry Contract & Temporal Calibration Sanitizer
 *
 * Validates high-frequency ocular telemetry frames, enforces screen-normalized
 * spatial bounds, bounds pupil diameters, flags blink artifacts, and restores
 * single-frame telemetry dropouts via linear temporal interpolation.
 */

const ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const MIN_CONFIDENCE = 0.6;
const MIN_PUPIL_MM = 1.5;
const MAX_PUPIL_MM = 9.0;
const BLINK_APERTURE_THRESHOLD = 0.15;
const MAX_VALID_DELTA_MS = 200.0; // Over 200ms gap indicates lost tracking

/**
 * Validates and sanitizes a single raw eye-tracking gaze telemetry frame.
 *
 * @param {object} frame
 * @returns {{ valid: boolean, errors: string[], sanitizedFrame?: object }}
 */
export function validateAndSanitizeGazeFrame(frame) {
  const errors = [];
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
    return { valid: false, errors: ['Gaze frame must be a non-null object'] };
  }

  // 1. Subject & Session IDs
  const subjectId = String(frame.subjectId || '').trim();
  if (!ID_REGEX.test(subjectId)) {
    errors.push(`Invalid subjectId "${frame.subjectId}": must match ^[a-zA-Z0-9_-]{1,64}$`);
  }

  const sessionId = String(frame.sessionId || '').trim();
  if (!ID_REGEX.test(sessionId)) {
    errors.push(`Invalid sessionId "${frame.sessionId}": must match ^[a-zA-Z0-9_-]{1,64}$`);
  }

  // 2. Timestamp
  const timestampMs = Number(frame.timestampMs);
  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    errors.push(`Timestamp (${frame.timestampMs}) must be a non-negative finite number`);
  }

  // 3. Confidence score
  const confidence = Number(frame.confidence);
  if (!Number.isFinite(confidence) || confidence < 0.0 || confidence > 1.0) {
    errors.push(`Confidence (${frame.confidence}) must be a float in [0.0, 1.0]`);
  }

  // 4. Coordinates (x, y)
  const x = Number(frame.x);
  const y = Number(frame.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    errors.push('Gaze coordinates (x, y) must be finite numbers');
  }

  // 5. Pupil Diameter & Aperture
  let pupilDiameterMm = Number(frame.pupilDiameterMm);
  let eyeAperture = Number(frame.eyeAperture);
  let isBlink = false;

  if (Number.isFinite(eyeAperture) && eyeAperture < BLINK_APERTURE_THRESHOLD) {
    isBlink = true;
  }
  if (!Number.isFinite(pupilDiameterMm) || pupilDiameterMm <= 0) {
    isBlink = true;
    pupilDiameterMm = 0.0;
  } else if (!isBlink && (pupilDiameterMm < MIN_PUPIL_MM || pupilDiameterMm > MAX_PUPIL_MM)) {
    errors.push(`Pupil diameter (${pupilDiameterMm}mm) outside valid physiological range [${MIN_PUPIL_MM}, ${MAX_PUPIL_MM}]`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Spatial clamping into normalized screen space [0.0, 1.0]
  const clampedX = Math.max(0.0, Math.min(1.0, x));
  const clampedY = Math.max(0.0, Math.min(1.0, y));

  return {
    valid: true,
    errors: [],
    sanitizedFrame: {
      subjectId,
      sessionId,
      timestampMs,
      confidence: confidence < MIN_CONFIDENCE ? 0.0 : confidence,
      x: clampedX,
      y: clampedY,
      pupilDiameterMm,
      isBlink,
      isLowConfidence: confidence < MIN_CONFIDENCE,
    },
  };
}

/**
 * Sanitizes a chronological sequence of gaze frames:
 * - Enforces strict timestamp monotonicity (drops duplicate/backward timestamps)
 * - Identifies single-frame dropouts and performs linear interpolation
 * - Flags prolonged tracking losses (> MAX_VALID_DELTA_MS)
 *
 * @param {Array<object>} rawFrames
 * @returns {Array<object>}
 */
export function sanitizeGazeSequence(rawFrames) {
  if (!Array.isArray(rawFrames) || rawFrames.length === 0) {
    return [];
  }

  const validFrames = [];
  let prevTimestamp = -Infinity;

  for (const raw of rawFrames) {
    const res = validateAndSanitizeGazeFrame(raw);
    if (!res.valid) {
      continue;
    }
    const frame = res.sanitizedFrame;

    // Enforce strictly increasing timestamps
    if (frame.timestampMs <= prevTimestamp) {
      continue; // Drop out-of-order or duplicate timestamp
    }
    prevTimestamp = frame.timestampMs;
    validFrames.push(frame);
  }

  if (validFrames.length <= 1) {
    return validFrames;
  }

  const calibrated = [];
  for (let i = 0; i < validFrames.length; i++) {
    const curr = validFrames[i];
    calibrated.push(curr);

    if (i < validFrames.length - 1) {
      const next = validFrames[i + 1];
      const deltaMs = next.timestampMs - curr.timestampMs;

      // Single-frame missing dropout detection (gap around 2x normal sampling interval, e.g. 25-45ms for 60Hz)
      if (deltaMs >= 25.0 && deltaMs <= 50.0 && !curr.isBlink && !next.isBlink) {
        // Interpolate synthetic frame
        const midTime = Number((curr.timestampMs + deltaMs / 2).toFixed(2));
        const midX = Number(((curr.x + next.x) / 2).toFixed(4));
        const midY = Number(((curr.y + next.y) / 2).toFixed(4));
        const midPupil = Number(((curr.pupilDiameterMm + next.pupilDiameterMm) / 2).toFixed(2));
        const midConf = Number(Math.min(curr.confidence, next.confidence).toFixed(2));

        calibrated.push({
          subjectId: curr.subjectId,
          sessionId: curr.sessionId,
          timestampMs: midTime,
          confidence: midConf,
          x: midX,
          y: midY,
          pupilDiameterMm: midPupil,
          isBlink: false,
          isLowConfidence: midConf < MIN_CONFIDENCE,
          isInterpolated: true,
        });
      }
    }
  }

  return calibrated;
}
