// Copyright (c) 2026 NeuroMirror Contributors
// SPDX-License-Identifier: MIT
// Unit tests for OcularFatigueDetector and PERCLOS calculation.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { OcularFatigueDetector } from "../assets/js/fatigue_detector.js";

describe("OcularFatigueDetector", () => {
  test("should compute zero PERCLOS and full attentiveness on alert baseline", () => {
    const detector = new OcularFatigueDetector();
    const t0 = 100000;

    // Record 60 seconds of alert samples (aperture 10mm) at 10Hz (every 100ms)
    for (let i = 0; i < 60; i++) {
      detector.recordSample(t0 + i * 1000, 10.0);
    }

    const res = detector.evaluate(t0 + 60000);
    assert.equal(res.perclos, 0.0);
    assert.equal(res.isDrowsy, false);
    assert.equal(res.microsleepDetected, false);
    assert.equal(res.attentivenessIndex, 1.0);
  });

  test("should detect drowsiness when PERCLOS exceeds threshold", () => {
    const detector = new OcularFatigueDetector({ perclosThreshold: 0.15 });
    const t0 = 200000;

    // Record 100 samples: 20 closed (1.0mm), 80 open (10.0mm) -> PERCLOS = 0.20 (20%)
    for (let i = 0; i < 100; i++) {
      const aperture = i < 20 ? 1.0 : 10.0;
      detector.recordSample(t0 + i * 100, aperture);
    }

    const res = detector.evaluate(t0 + 10000);
    assert.equal(res.perclos, 0.2);
    assert.equal(res.isDrowsy, true);
    assert.ok(res.attentivenessIndex < 0.6);
  });

  test("should detect prolonged microsleep episodes", () => {
    const detector = new OcularFatigueDetector({ microsleepDurationMs: 400 });
    const t0 = 300000;

    // Normal open eye
    detector.recordSample(t0, 10.0);

    // Eye closes at t0 + 100ms and stays closed until t0 + 700ms (duration 600ms > 400ms)
    detector.recordSample(t0 + 100, 1.0);
    detector.recordSample(t0 + 400, 1.0);
    detector.recordSample(t0 + 700, 1.0);
    detector.recordSample(t0 + 800, 10.0); // Eye reopens

    const res = detector.evaluate(t0 + 1000);
    assert.equal(res.microsleepDetected, true);
    assert.equal(res.isDrowsy, true);
    assert.equal(res.blinkCount, 1);
    assert.equal(res.avgBlinkDurationMs, 700); // 800 - 100 = 700ms
  });

  test("should evict old samples outside sliding window", () => {
    const detector = new OcularFatigueDetector({ windowMs: 5000 });
    const t0 = 400000;

    // Normal brief blink at t0 (closed for 200ms, not a microsleep)
    detector.recordSample(t0, 10.0);
    detector.recordSample(t0 + 100, 1.0);
    detector.recordSample(t0 + 300, 10.0);

    // Advance time past 5s window to t0 + 10000ms
    detector.recordSample(t0 + 10000, 10.0);
    detector.recordSample(t0 + 11000, 10.0);

    const res = detector.evaluate(t0 + 12000);
    // Old closed samples were pruned; only 2 alert samples remain
    assert.equal(res.perclos, 0.0);
    assert.equal(res.isDrowsy, false);
    assert.equal(res.blinkCount, 0); // Old blink evicted
  });

  test("should handle empty state and reset gracefully", () => {
    const detector = new OcularFatigueDetector();
    const res = detector.evaluate();
    assert.equal(res.perclos, 0.0);
    assert.equal(res.attentivenessIndex, 1.0);

    detector.recordSample(100, 1.0);
    detector.reset();
    assert.equal(detector.samples.length, 0);
  });
});
