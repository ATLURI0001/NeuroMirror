import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAndSanitizePupilMetric,
  migratePupilSchema,
  validatePupilDiameter,
  validateAnisocoria,
  PupilContractError,
} from '../assets/js/pupil_dilation_contract.js';

test('validateAndSanitizePupilMetric: validates healthy v2 pupillometry record', () => {
  const payload = {
    version: 'neuromirror/pupil-v2',
    timestampMs: 15000,
    left_diameter_mm: 3.85,
    right_diameter_mm: 3.90,
    baseline_luminance_lux: 120.5,
    confidence: 0.95,
  };

  const sanitized = validateAndSanitizePupilMetric(payload);
  assert.equal(sanitized.version, 'neuromirror/pupil-v2');
  assert.equal(sanitized.left_diameter_mm, 3.85);
  assert.equal(sanitized.right_diameter_mm, 3.9);
  assert.equal(sanitized.mean_diameter_mm, 3.875);
  assert.equal(sanitized.anisocoria_mm, 0.05);
  assert.equal(sanitized.confidence, 0.95);
});

test('migratePupilSchema: migrates legacy v1 pupil payload to v2', () => {
  const legacy = {
    version: 'neuromirror/pupil-v1',
    timestamp: 8500,
    pupilSize: 4.2,
    lux: 80.0,
    confidence: 0.88,
  };

  const migrated = migratePupilSchema(legacy);
  assert.equal(migrated.version, 'neuromirror/pupil-v2');
  assert.equal(migrated.left_diameter_mm, 4.2);
  assert.equal(migrated.right_diameter_mm, 4.2);
  assert.equal(migrated.metadata.migratedFrom, 'neuromirror/pupil-v1');

  // Sanitizer processes migrated payload seamlessly
  const sanitized = validateAndSanitizePupilMetric(legacy);
  assert.equal(sanitized.mean_diameter_mm, 4.2);
});

test('validatePupilDiameter: enforces physiological bounds [1.5mm, 9.0mm]', () => {
  // Below physiological min
  assert.throws(
    () => validatePupilDiameter(0.8, 'left'),
    (err) => err instanceof PupilContractError && err.code === 'DIAMETER_OUT_OF_PHYSIOLOGICAL_RANGE'
  );

  // Above physiological max
  assert.throws(
    () => validatePupilDiameter(12.5, 'right'),
    (err) => err instanceof PupilContractError && err.code === 'DIAMETER_OUT_OF_PHYSIOLOGICAL_RANGE'
  );

  // Non-number
  assert.throws(
    () => validatePupilDiameter('4.5', 'left'),
    (err) => err instanceof PupilContractError && err.code === 'INVALID_DIAMETER_TYPE'
  );
});

test('validateAnisocoria: detects pathological bilateral disparity', () => {
  // Within bounds
  const diff = validateAnisocoria(3.5, 4.2);
  assert.equal(diff, 0.7);

  // Disparity > 1.5mm
  assert.throws(
    () => validateAnisocoria(2.0, 4.5),
    (err) => err instanceof PupilContractError && err.code === 'EXCESSIVE_ANISOCORIA_DETECTED'
  );
});
