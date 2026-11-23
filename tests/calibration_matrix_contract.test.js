import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAndSanitizeCalibrationManifest } from '../assets/js/calibration_matrix_contract.js';

test('validateAndSanitizeCalibrationManifest: validates compliant 9-point grid', () => {
  const valid9Point = {
    gridId: 'calib-session-001',
    layout: '9-point',
    screenResolution: { widthPx: 1920, heightPx: 1080 },
    points: [
      { pointId: 'p0', targetX: 0.1, targetY: 0.1, samples: [{ gazeX: 0.102, gazeY: 0.098 }, { gazeX: 0.099, gazeY: 0.101 }, { gazeX: 0.1, gazeY: 0.1 }] },
      { pointId: 'p1', targetX: 0.5, targetY: 0.1, samples: [{ gazeX: 0.501, gazeY: 0.102 }, { gazeX: 0.499, gazeY: 0.099 }, { gazeX: 0.5, gazeY: 0.1 }] },
      { pointId: 'p2', targetX: 0.9, targetY: 0.1, samples: [{ gazeX: 0.898, gazeY: 0.101 }, { gazeX: 0.902, gazeY: 0.099 }, { gazeX: 0.9, gazeY: 0.1 }] },
      { pointId: 'p3', targetX: 0.1, targetY: 0.5, samples: [{ gazeX: 0.101, gazeY: 0.502 }, { gazeX: 0.099, gazeY: 0.498 }, { gazeX: 0.1, gazeY: 0.5 }] },
      { pointId: 'p4', targetX: 0.5, targetY: 0.5, samples: [{ gazeX: 0.501, gazeY: 0.499 }, { gazeX: 0.499, gazeY: 0.501 }, { gazeX: 0.5, gazeY: 0.5 }] },
      { pointId: 'p5', targetX: 0.9, targetY: 0.5, samples: [{ gazeX: 0.901, gazeY: 0.499 }, { gazeX: 0.899, gazeY: 0.502 }, { gazeX: 0.9, gazeY: 0.5 }] },
      { pointId: 'p6', targetX: 0.1, targetY: 0.9, samples: [{ gazeX: 0.099, gazeY: 0.901 }, { gazeX: 0.102, gazeY: 0.898 }, { gazeX: 0.1, gazeY: 0.9 }] },
      { pointId: 'p7', targetX: 0.5, targetY: 0.9, samples: [{ gazeX: 0.502, gazeY: 0.899 }, { gazeX: 0.498, gazeY: 0.901 }, { gazeX: 0.5, gazeY: 0.9 }] },
      { pointId: 'p8', targetX: 0.9, targetY: 0.9, samples: [{ gazeX: 0.899, gazeY: 0.902 }, { gazeX: 0.901, gazeY: 0.898 }, { gazeX: 0.9, gazeY: 0.9 }] },
    ],
  };

  const res = validateAndSanitizeCalibrationManifest(valid9Point);
  assert.equal(res.valid, true);
  assert.equal(res.errors.length, 0);
  assert.equal(res.sanitizedManifest.pointCount, 9);
  assert.equal(res.sanitizedManifest.points[0].targetPx.x, 192);
  assert.equal(res.sanitizedManifest.points[0].targetPx.y, 108);
  assert.equal(res.sanitizedManifest.points[0].qualityGrade, 'OPTIMAL');
  assert.ok(res.sanitizedManifest.spatialCoverage.spanX >= 0.8);
  assert.ok(res.sanitizedManifest.spatialCoverage.spanY >= 0.8);
});

test('validateAndSanitizeCalibrationManifest: rejects invalid manifest root and IDs', () => {
  assert.equal(validateAndSanitizeCalibrationManifest(null).valid, false);
  assert.equal(validateAndSanitizeCalibrationManifest('string').valid, false);

  const badId = {
    gridId: 'invalid ID with spaces!!',
    layout: '9-point',
    screenResolution: { widthPx: 1920, heightPx: 1080 },
    points: [],
  };
  const res = validateAndSanitizeCalibrationManifest(badId);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('Invalid gridId')));
});

test('validateAndSanitizeCalibrationManifest: rejects invalid screen resolution and layouts', () => {
  const badScreen = {
    gridId: 'calib-1',
    layout: 'unsupported-layout',
    screenResolution: { widthPx: 100, heightPx: 50 },
    points: [],
  };
  const res = validateAndSanitizeCalibrationManifest(badScreen);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('Unsupported layout')));
  assert.ok(res.errors.some(e => e.includes('Invalid screen widthPx')));
});

test('validateAndSanitizeCalibrationManifest: rejects insufficient points and sample counts', () => {
  const shortPoints = {
    gridId: 'calib-2',
    layout: 'custom',
    screenResolution: { widthPx: 1920, heightPx: 1080 },
    points: [
      { pointId: 'p0', targetX: 0.1, targetY: 0.1, samples: [] },
      { pointId: 'p1', targetX: 0.5, targetY: 0.5, samples: [] },
    ],
  };
  const res = validateAndSanitizeCalibrationManifest(shortPoints);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('at least 5 targets')));
});

test('validateAndSanitizeCalibrationManifest: rejects insufficient spatial span', () => {
  // All points clustered in a tiny 0.05 x 0.05 box
  const clusteredPoints = {
    gridId: 'calib-3',
    layout: 'custom',
    screenResolution: { widthPx: 1920, heightPx: 1080 },
    points: [
      { pointId: 'p0', targetX: 0.50, targetY: 0.50, samples: [{ gazeX: 0.5, gazeY: 0.5 }, { gazeX: 0.5, gazeY: 0.5 }, { gazeX: 0.5, gazeY: 0.5 }] },
      { pointId: 'p1', targetX: 0.51, targetY: 0.50, samples: [{ gazeX: 0.5, gazeY: 0.5 }, { gazeX: 0.5, gazeY: 0.5 }, { gazeX: 0.5, gazeY: 0.5 }] },
      { pointId: 'p2', targetX: 0.52, targetY: 0.50, samples: [{ gazeX: 0.5, gazeY: 0.5 }, { gazeX: 0.5, gazeY: 0.5 }, { gazeX: 0.5, gazeY: 0.5 }] },
      { pointId: 'p3', targetX: 0.50, targetY: 0.51, samples: [{ gazeX: 0.5, gazeY: 0.5 }, { gazeX: 0.5, gazeY: 0.5 }, { gazeX: 0.5, gazeY: 0.5 }] },
      { pointId: 'p4', targetX: 0.51, targetY: 0.52, samples: [{ gazeX: 0.5, gazeY: 0.5 }, { gazeX: 0.5, gazeY: 0.5 }, { gazeX: 0.5, gazeY: 0.5 }] },
    ],
  };
  const res = validateAndSanitizeCalibrationManifest(clusteredPoints);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some(e => e.includes('insufficient: must cover at least 40%')));
});
