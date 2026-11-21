import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAndSanitizeGazeFrame,
  sanitizeGazeSequence,
} from '../assets/js/gaze_contract.js';

describe('Gaze Ingress Telemetry Contract & Temporal Calibration Sanitizer', () => {
  describe('validateAndSanitizeGazeFrame', () => {
    it('should validate and construct a clean normalized gaze frame', () => {
      const raw = {
        subjectId: 'SUBJ_001',
        sessionId: 'SESS_A',
        timestampMs: 1000.0,
        x: 0.45,
        y: 0.62,
        confidence: 0.95,
        pupilDiameterMm: 3.5,
        eyeAperture: 0.85,
      };

      const res = validateAndSanitizeGazeFrame(raw);
      assert.equal(res.valid, true);
      assert.equal(res.sanitizedFrame.x, 0.45);
      assert.equal(res.sanitizedFrame.y, 0.62);
      assert.equal(res.sanitizedFrame.pupilDiameterMm, 3.5);
      assert.equal(res.sanitizedFrame.isBlink, false);
      assert.equal(res.sanitizedFrame.isLowConfidence, false);
    });

    it('should clamp out-of-bounds coordinates to normalized range [0.0, 1.0]', () => {
      const raw = {
        subjectId: 'SUBJ_001',
        sessionId: 'SESS_A',
        timestampMs: 1000.0,
        x: 1.25, // > 1.0
        y: -0.15, // < 0.0
        confidence: 0.9,
        pupilDiameterMm: 4.0,
        eyeAperture: 0.8,
      };

      const res = validateAndSanitizeGazeFrame(raw);
      assert.equal(res.valid, true);
      assert.equal(res.sanitizedFrame.x, 1.0);
      assert.equal(res.sanitizedFrame.y, 0.0);
    });

    it('should reject invalid IDs and malformed inputs', () => {
      const bad = {
        subjectId: 'SUBJ<script>',
        sessionId: 'INVALID SESSION ID WITH SPACES',
        timestampMs: -10,
        confidence: 1.5,
      };

      const res = validateAndSanitizeGazeFrame(bad);
      assert.equal(res.valid, false);
      assert.ok(res.errors.length >= 3);
    });

    it('should detect blinks when aperture or pupil diameter collapses', () => {
      const blinkRaw = {
        subjectId: 'SUBJ_001',
        sessionId: 'SESS_A',
        timestampMs: 1000.0,
        x: 0.5,
        y: 0.5,
        confidence: 0.8,
        pupilDiameterMm: 0.0,
        eyeAperture: 0.05,
      };

      const res = validateAndSanitizeGazeFrame(blinkRaw);
      assert.equal(res.valid, true);
      assert.equal(res.sanitizedFrame.isBlink, true);
    });

    it('should flag low-confidence samples', () => {
      const lowConf = {
        subjectId: 'SUBJ_001',
        sessionId: 'SESS_A',
        timestampMs: 1000.0,
        x: 0.5,
        y: 0.5,
        confidence: 0.35, // < 0.6
        pupilDiameterMm: 3.5,
        eyeAperture: 0.7,
      };

      const res = validateAndSanitizeGazeFrame(lowConf);
      assert.equal(res.valid, true);
      assert.equal(res.sanitizedFrame.isLowConfidence, true);
      assert.equal(res.sanitizedFrame.confidence, 0.0);
    });
  });

  describe('sanitizeGazeSequence', () => {
    it('should enforce strict timestamp monotonicity and drop out-of-order frames', () => {
      const sequence = [
        { subjectId: 'S1', sessionId: 'E1', timestampMs: 100, x: 0.1, y: 0.1, confidence: 0.9, pupilDiameterMm: 3.0, eyeAperture: 0.8 },
        { subjectId: 'S1', sessionId: 'E1', timestampMs: 100, x: 0.2, y: 0.2, confidence: 0.9, pupilDiameterMm: 3.0, eyeAperture: 0.8 }, // Duplicate
        { subjectId: 'S1', sessionId: 'E1', timestampMs: 90, x: 0.3, y: 0.3, confidence: 0.9, pupilDiameterMm: 3.0, eyeAperture: 0.8 }, // Backward
        { subjectId: 'S1', sessionId: 'E1', timestampMs: 116, x: 0.2, y: 0.2, confidence: 0.9, pupilDiameterMm: 3.0, eyeAperture: 0.8 },
      ];

      const res = sanitizeGazeSequence(sequence);
      assert.equal(res.length, 2);
      assert.equal(res[0].timestampMs, 100);
      assert.equal(res[1].timestampMs, 116);
    });

    it('should interpolate single-frame dropouts linearly', () => {
      // 60Hz sequence: interval should be ~16.6ms. Gap between 100ms and 133.3ms is 33.3ms (1 missing frame)
      const sequence = [
        { subjectId: 'S1', sessionId: 'E1', timestampMs: 100.0, x: 0.2, y: 0.4, confidence: 0.8, pupilDiameterMm: 3.0, eyeAperture: 0.8 },
        { subjectId: 'S1', sessionId: 'E1', timestampMs: 133.3, x: 0.4, y: 0.6, confidence: 0.8, pupilDiameterMm: 4.0, eyeAperture: 0.8 },
      ];

      const res = sanitizeGazeSequence(sequence);
      assert.equal(res.length, 3);
      // Interpolated frame inserted in middle
      assert.equal(res[1].isInterpolated, true);
      assert.equal(res[1].x, 0.3); // (0.2 + 0.4) / 2
      assert.equal(res[1].y, 0.5); // (0.4 + 0.6) / 2
      assert.equal(res[1].pupilDiameterMm, 3.5); // (3.0 + 4.0) / 2
    });
  });
});
