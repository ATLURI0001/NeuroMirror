import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAndSanitizeGazeEvent,
  migrateGazeEventSchema,
  validateBoundingBox,
  validateNormalizedPoint,
  GazeEventContractError,
} from '../assets/js/gaze_event_contract.js';

test('validateAndSanitizeGazeEvent: validates healthy v2 fixation event', () => {
  const payload = {
    version: 'neuromirror/event-v2',
    eventType: 'FIXATION',
    duration_ms: 250,
    timestampMs: 12000,
    position: { x: 0.45, y: 0.55 },
    aoi_id: 'aoi_navbar',
    bounding_box: { minX: 0.1, minY: 0.1, maxX: 0.9, maxY: 0.3 },
  };

  const sanitized = validateAndSanitizeGazeEvent(payload);
  assert.equal(sanitized.version, 'neuromirror/event-v2');
  assert.equal(sanitized.eventType, 'FIXATION');
  assert.equal(sanitized.durationMs, 250);
  assert.equal(sanitized.position.x, 0.45);
  assert.equal(sanitized.aoi.aoi_id, 'aoi_navbar');
  assert.equal(sanitized.aoi.bounding_box.width, 0.8);
});

test('migrateGazeEventSchema: migrates legacy v1 schema to v2 format', () => {
  const legacy = {
    version: 'neuromirror/event-v1',
    eventType: 'SACCADE',
    duration: 35,
    timestampMs: 5000,
    coords: [0.2, 0.8],
    aoiName: 'hero_cta',
    box: { minX: 0.15, minY: 0.7, maxX: 0.35, maxY: 0.85 },
  };

  const migrated = migrateGazeEventSchema(legacy);
  assert.equal(migrated.version, 'neuromirror/event-v2');
  assert.equal(migrated.duration_ms, 35);
  assert.deepEqual(migrated.position, { x: 0.2, y: 0.8 });
  assert.equal(migrated.aoi_id, 'hero_cta');
  assert.ok(migrated.bounding_box);

  // Sanitizer processes migrated payload seamlessly
  const sanitized = validateAndSanitizeGazeEvent(legacy);
  assert.equal(sanitized.eventType, 'SACCADE');
  assert.equal(sanitized.durationMs, 35);
});

test('validateBoundingBox: rejects degenerate and out-of-bounds bounding boxes', () => {
  // Degenerate box: minX >= maxX
  assert.throws(
    () => validateBoundingBox({ minX: 0.5, minY: 0.1, maxX: 0.4, maxY: 0.6 }),
    (err) => err instanceof GazeEventContractError && err.code === 'DEGENERATE_BOUNDING_BOX'
  );

  // Out of bounds: coordinate > 1.0
  assert.throws(
    () => validateBoundingBox({ minX: 0.1, minY: 0.1, maxX: 1.5, maxY: 0.6 }),
    (err) => err instanceof GazeEventContractError && err.code === 'BOX_OUT_OF_BOUNDS'
  );
});

test('validateAndSanitizeGazeEvent: rejects duration boundary violations', () => {
  // Fixation too short (< 50ms)
  assert.throws(
    () => validateAndSanitizeGazeEvent({
      eventType: 'FIXATION',
      duration_ms: 10,
      timestampMs: 1000,
      position: { x: 0.5, y: 0.5 },
    }),
    (err) => err instanceof GazeEventContractError && err.code === 'DURATION_OUT_OF_BOUNDS'
  );

  // Saccade too long (> 300ms)
  assert.throws(
    () => validateAndSanitizeGazeEvent({
      eventType: 'SACCADE',
      duration_ms: 500,
      timestampMs: 1000,
      position: { x: 0.5, y: 0.5 },
    }),
    (err) => err instanceof GazeEventContractError && err.code === 'DURATION_OUT_OF_BOUNDS'
  );
});
