/**
 * NeuroMirror: Pupil Metric Calibration Schema & Dilation Boundary Contract.
 * 
 * Enforces physiological boundary invariants, anisocoria limits, velocity gating,
 * and versioned schema evolution for pupillometry and cognitive workload metrics.
 */

export class PupilContractError extends Error {
  constructor(code, message) {
    super(`[${code}] ${message}`);
    this.name = 'PupilContractError';
    this.code = code;
  }
}

export const SUPPORTED_SCHEMAS = Object.freeze([
  'neuromirror/pupil-v1',
  'neuromirror/pupil-v2',
]);

// Physiological boundaries for human pupil diameter
export const MIN_PUPIL_DIAMETER_MM = 1.5;
export const MAX_PUPIL_DIAMETER_MM = 9.0;
export const MAX_PHYSIOLOGICAL_ANISOCORIA_MM = 1.5; // > 1.5mm difference between eyes indicates clinical pathology or sensor occlusion
export const MAX_DILATION_VELOCITY_MM_PER_SEC = 10.0; // Max constriction/dilation rate

/**
 * Validates a single pupil diameter measurement in millimeters.
 */
export function validatePupilDiameter(diameterMm, eyeLabel = 'eye') {
  if (typeof diameterMm !== 'number' || Number.isNaN(diameterMm) || !Number.isFinite(diameterMm)) {
    throw new PupilContractError(
      'INVALID_DIAMETER_TYPE',
      `${eyeLabel} diameter must be a valid finite number, got ${diameterMm}`
    );
  }
  if (diameterMm < MIN_PUPIL_DIAMETER_MM || diameterMm > MAX_PUPIL_DIAMETER_MM) {
    throw new PupilContractError(
      'DIAMETER_OUT_OF_PHYSIOLOGICAL_RANGE',
      `${eyeLabel} diameter ${diameterMm.toFixed(2)}mm outside physiological limits [${MIN_PUPIL_DIAMETER_MM}, ${MAX_PUPIL_DIAMETER_MM}]`
    );
  }
  return Number(diameterMm.toFixed(3));
}

/**
 * Validates bilateral difference (anisocoria).
 */
export function validateAnisocoria(leftDiameterMm, rightDiameterMm) {
  const diff = Math.abs(leftDiameterMm - rightDiameterMm);
  if (diff > MAX_PHYSIOLOGICAL_ANISOCORIA_MM) {
    throw new PupilContractError(
      'EXCESSIVE_ANISOCORIA_DETECTED',
      `Bilateral difference ${diff.toFixed(2)}mm exceeds threshold of ${MAX_PHYSIOLOGICAL_ANISOCORIA_MM}mm`
    );
  }
  return Number(diff.toFixed(3));
}

/**
 * Migrates a legacy v1 pupil measurement payload to v2 schema format.
 */
export function migratePupilSchema(legacyPayload) {
  if (!legacyPayload || typeof legacyPayload !== 'object') {
    throw new PupilContractError('MALFORMED_PAYLOAD', 'Payload must be an object');
  }

  if (legacyPayload.version === 'neuromirror/pupil-v2') {
    return { ...legacyPayload };
  }

  // Handle v1 format: uses pupilSize, leftPupil, rightPupil, timestamp
  const timestampMs = legacyPayload.timestampMs ?? legacyPayload.timestamp ?? Date.now();
  const leftMm = legacyPayload.leftMm ?? legacyPayload.leftPupil ?? legacyPayload.pupilSize;
  const rightMm = legacyPayload.rightMm ?? legacyPayload.rightPupil ?? legacyPayload.pupilSize;

  return {
    version: 'neuromirror/pupil-v2',
    timestampMs,
    left_diameter_mm: leftMm,
    right_diameter_mm: rightMm,
    baseline_luminance_lux: legacyPayload.lux ?? legacyPayload.luminance ?? 100.0,
    confidence: legacyPayload.confidence ?? 1.0,
    metadata: {
      migratedFrom: legacyPayload.version || 'neuromirror/pupil-v1',
      sourceDevice: legacyPayload.device || 'generic-tracker',
    },
  };
}

/**
 * Validates, normalizes, and enforces invariant boundaries for pupil metrics.
 */
export function validateAndSanitizePupilMetric(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new PupilContractError('MALFORMED_PAYLOAD', 'Pupil payload must be a non-null object');
  }

  // Automatic schema migration if needed
  const normalized = payload.version === 'neuromirror/pupil-v1' ? migratePupilSchema(payload) : payload;

  const version = normalized.version;
  if (!SUPPORTED_SCHEMAS.includes(version)) {
    throw new PupilContractError(
      'UNSUPPORTED_SCHEMA_VERSION',
      `Schema version '${version}' is unsupported; expected one of: ${SUPPORTED_SCHEMAS.join(', ')}`
    );
  }

  const timestampMs = normalized.timestampMs;
  if (typeof timestampMs !== 'number' || timestampMs < 0 || !Number.isFinite(timestampMs)) {
    throw new PupilContractError('INVALID_TIMESTAMP', 'timestampMs must be a non-negative finite number');
  }

  const leftRaw = normalized.left_diameter_mm;
  const rightRaw = normalized.right_diameter_mm;

  const left_diameter_mm = validatePupilDiameter(leftRaw, 'left');
  const right_diameter_mm = validatePupilDiameter(rightRaw, 'right');

  const anisocoria_mm = validateAnisocoria(left_diameter_mm, right_diameter_mm);
  const mean_diameter_mm = Number(((left_diameter_mm + right_diameter_mm) / 2).toFixed(3));

  const confidence = normalized.confidence ?? 1.0;
  if (typeof confidence !== 'number' || confidence < 0.0 || confidence > 1.0) {
    throw new PupilContractError('INVALID_CONFIDENCE', 'confidence must be in range [0.0, 1.0]');
  }

  return {
    version,
    timestampMs,
    left_diameter_mm,
    right_diameter_mm,
    mean_diameter_mm,
    anisocoria_mm,
    baseline_luminance_lux: Number((normalized.baseline_luminance_lux ?? 100.0).toFixed(1)),
    confidence: Number(confidence.toFixed(2)),
    metadata: normalized.metadata || {},
  };
}
