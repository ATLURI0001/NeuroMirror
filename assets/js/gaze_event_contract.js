/**
 * Gaze Event Schema & Bounding Box AOI Contract Guard.
 *
 * Enforces contract invariants, schema version migrations (v1 -> v2),
 * Area-Of-Interest (AOI) bounding box integrity, and fixation/saccade duration bounds.
 */

export const SUPPORTED_EVENT_VERSIONS = new Set(['neuromirror/event-v1', 'neuromirror/event-v2']);
export const VALID_EVENT_TYPES = new Set(['FIXATION', 'SACCADE', 'GLANCE', 'SMOOTH_PURSUIT']);

export class GazeEventContractError extends Error {
  constructor(code, message) {
    super(`[${code}] ${message}`);
    this.name = 'GazeEventContractError';
    this.code = code;
  }
}

/**
 * Migrates legacy v1 event schemas to modern v2 specification.
 */
export function migrateGazeEventSchema(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    throw new GazeEventContractError('INVALID_PAYLOAD', 'Payload must be a non-null object');
  }

  const payload = { ...rawPayload };
  const version = payload.version || 'neuromirror/event-v1';

  if (!SUPPORTED_EVENT_VERSIONS.has(version)) {
    throw new GazeEventContractError('UNSUPPORTED_VERSION', `Schema version '${version}' is not supported`);
  }

  if (version === 'neuromirror/event-v1') {
    // Migration rules:
    if (payload.aoiName && !payload.aoi_id) {
      payload.aoi_id = String(payload.aoiName);
      delete payload.aoiName;
    }
    if (payload.box && !payload.bounding_box) {
      payload.bounding_box = payload.box;
      delete payload.box;
    }
    if (payload.duration && payload.duration_ms === undefined) {
      payload.duration_ms = payload.duration;
      delete payload.duration;
    }
    if (Array.isArray(payload.coords) && payload.coords.length === 2 && !payload.position) {
      payload.position = { x: payload.coords[0], y: payload.coords[1] };
      delete payload.coords;
    }
    payload.version = 'neuromirror/event-v2';
  }

  return payload;
}

/**
 * Validates normalized screen coordinate point.
 */
export function validateNormalizedPoint(pt) {
  if (!pt || typeof pt !== 'object') {
    throw new GazeEventContractError('INVALID_POINT', 'Point must be an object {x, y}');
  }
  const x = Number(pt.x);
  const y = Number(pt.y);
  if (!Number.isFinite(x) || x < 0.0 || x > 1.0) {
    throw new GazeEventContractError('COORDINATE_OUT_OF_BOUNDS', `Point x (${pt.x}) must be in [0.0, 1.0]`);
  }
  if (!Number.isFinite(y) || y < 0.0 || y > 1.0) {
    throw new GazeEventContractError('COORDINATE_OUT_OF_BOUNDS', `Point y (${pt.y}) must be in [0.0, 1.0]`);
  }
  return { x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) };
}

/**
 * Validates and normalizes an Area Of Interest (AOI) bounding box.
 */
export function validateBoundingBox(box) {
  if (!box || typeof box !== 'object') {
    throw new GazeEventContractError('INVALID_BOUNDING_BOX', 'Bounding box must be an object');
  }

  const minX = Number(box.minX !== undefined ? box.minX : box.x_min);
  const minY = Number(box.minY !== undefined ? box.minY : box.y_min);
  const maxX = Number(box.maxX !== undefined ? box.maxX : box.x_max);
  const maxY = Number(box.maxY !== undefined ? box.maxY : box.y_max);

  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    throw new GazeEventContractError('INVALID_BOX_COORDINATES', 'All bounding box coordinates must be finite numbers');
  }

  if (minX < 0.0 || maxX > 1.0 || minY < 0.0 || maxY > 1.0) {
    throw new GazeEventContractError('BOX_OUT_OF_BOUNDS', 'Bounding box coordinates must be within [0.0, 1.0]');
  }

  if (minX >= maxX || minY >= maxY) {
    throw new GazeEventContractError(
      'DEGENERATE_BOUNDING_BOX',
      `Bounding box has non-positive area: [${minX}, ${minY}] to [${maxX}, ${maxY}]`
    );
  }

  return {
    minX: Number(minX.toFixed(4)),
    minY: Number(minY.toFixed(4)),
    maxX: Number(maxX.toFixed(4)),
    maxY: Number(maxY.toFixed(4)),
    width: Number((maxX - minX).toFixed(4)),
    height: Number((maxY - minY).toFixed(4)),
  };
}

/**
 * Validates, normalizes, and sanitizes an incoming gaze event specification.
 */
export function validateAndSanitizeGazeEvent(rawPayload) {
  const payload = migrateGazeEventSchema(rawPayload);

  const eventType = String(payload.eventType || payload.event_type || '').toUpperCase().trim();
  if (!VALID_EVENT_TYPES.has(eventType)) {
    throw new GazeEventContractError('INVALID_EVENT_TYPE', `Event type '${eventType}' not recognized`);
  }

  const durationMs = Number(payload.duration_ms);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new GazeEventContractError('INVALID_DURATION', `Duration must be a positive number, got ${payload.duration_ms}`);
  }

  // Event specific duration sanity bounds
  if (eventType === 'FIXATION' && (durationMs < 50 || durationMs > 5000)) {
    throw new GazeEventContractError(
      'DURATION_OUT_OF_BOUNDS',
      `Fixation duration (${durationMs}ms) must be between 50ms and 5000ms`
    );
  }
  if (eventType === 'SACCADE' && (durationMs < 5 || durationMs > 300)) {
    throw new GazeEventContractError(
      'DURATION_OUT_OF_BOUNDS',
      `Saccade duration (${durationMs}ms) must be between 5ms and 300ms`
    );
  }

  const timestampMs = Number(payload.timestamp_ms || payload.timestampMs);
  if (!Number.isFinite(timestampMs) || timestampMs < 0) {
    throw new GazeEventContractError('INVALID_TIMESTAMP', 'Timestamp must be a non-negative number');
  }

  const position = validateNormalizedPoint(payload.position);

  let aoi = null;
  if (payload.aoi_id || payload.bounding_box) {
    const aoiId = String(payload.aoi_id || 'default_aoi').trim();
    if (!aoiId) {
      throw new GazeEventContractError('INVALID_AOI_ID', 'AOI id cannot be empty');
    }
    const box = payload.bounding_box ? validateBoundingBox(payload.bounding_box) : null;
    aoi = { aoi_id: aoiId, bounding_box: box };
  }

  return {
    version: payload.version,
    eventType,
    durationMs: Number(durationMs.toFixed(2)),
    timestampMs,
    position,
    aoi,
  };
}
