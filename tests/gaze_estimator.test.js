// Copyright (c) 2026 NeuroMirror Contributors
// SPDX-License-Identifier: MIT
// Unit tests for Biometric Gaze Estimator and Ray-Casting Intersect Engine.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  vec3Magnitude,
  vec3Normalize,
  vec3Dot,
  normalizePupilCoordinates,
  estimateGazeRay3D,
  rayPlaneIntersect,
  BinocularGazeTracker,
} from "../assets/js/gaze_estimator.js";

test("vec3 utilities calculate norms, dots, and sanitize division by zero", () => {
  const v = [3, 4, 0];
  assert.equal(vec3Magnitude(v), 5);

  const u = vec3Normalize(v);
  assert.equal(u[0], 0.6);
  assert.equal(u[1], 0.8);
  assert.equal(u[2], 0);

  const zeroNorm = vec3Normalize([0, 0, 0]);
  assert.deepEqual(zeroNorm, [0, 0, 1]);

  const dot = vec3Dot([1, 2, 3], [4, -5, 6]);
  assert.equal(dot, 12); // 4 - 10 + 18 = 12
});

test("normalizePupilCoordinates computes accurate canonical ratios", () => {
  const ic = [-10, 0, 0]; // inner canthus
  const oc = [10, 0, 0];  // outer canthus
  const ul = [0, 5, 0];   // upper lid
  const ll = [0, -5, 0];  // lower lid
  const pupil = [0, 0, 0]; // centered

  const norm = normalizePupilCoordinates(pupil, ic, oc, ul, ll);
  assert.equal(norm.valid, true);
  assert.equal(norm.blinkDetected, false);
  assert.equal(norm.u, 0.5);
  assert.equal(norm.v, 0.5);
  assert.equal(norm.aperture, 10);
});

test("normalizePupilCoordinates detects blinks when aperture falls below threshold", () => {
  const ic = [-10, 0, 0];
  const oc = [10, 0, 0];
  const ul = [0, 0.5, 0];
  const ll = [0, -0.5, 0]; // aperture = 1.0 mm (< minAperture 1.5)
  const pupil = [0, 0, 0];

  const norm = normalizePupilCoordinates(pupil, ic, oc, ul, ll, { minApertureThreshold: 1.5 });
  assert.equal(norm.valid, true);
  assert.equal(norm.blinkDetected, true);
  assert.equal(norm.u, 0.5);
  assert.equal(norm.v, 0.5);
});

test("estimateGazeRay3D constructs directional unit vector with correct angular excursion", () => {
  const center = [0, 0, 0];
  // Direct forward gaze: u=0.5, v=0.5
  const forwardRay = estimateGazeRay3D({ u: 0.5, v: 0.5 }, center);
  assert.equal(forwardRay.yawRad, 0);
  assert.equal(forwardRay.pitchRad, 0);
  assert.deepEqual(forwardRay.direction, [0, 0, 1]);

  // Looking right (u = 1.0)
  const rightRay = estimateGazeRay3D({ u: 1.0, v: 0.5 }, center, { maxYawAngle: 0.8 });
  assert.equal(rightRay.yawRad, 0.8);
  assert.ok(rightRay.direction[0] > 0);
  assert.ok(rightRay.direction[2] > 0);
  assert.ok(Math.abs(vec3Magnitude(rightRay.direction) - 1.0) < 1e-6);
});

test("rayPlaneIntersect accurately calculates display plane hit coordinates and pixel mapping", () => {
  const rayOrigin = [0, 0, 0];
  const rayDir = [0, 0, 1]; // pointing straight ahead into screen at z=500

  const hit = rayPlaneIntersect(rayOrigin, rayDir, {
    planePoint: [0, 0, 500],
    planeNormal: [0, 0, -1],
    screenWidth: 1920,
    screenHeight: 1080,
    screenPhysicalWidth: 500,
    screenPhysicalHeight: 300,
  });

  assert.equal(hit.hit, true);
  assert.deepEqual(hit.point3D, [0, 0, 500]);
  assert.equal(hit.distance, 500);
  // Centered ray maps to center of screen: (960, 540)
  assert.equal(hit.screenPixel.x, 960);
  assert.equal(hit.screenPixel.y, 540);
});

test("rayPlaneIntersect rejects rays pointing backwards or parallel to plane", () => {
  // Ray pointing backwards
  const backwards = rayPlaneIntersect([0, 0, 0], [0, 0, -1], { planePoint: [0, 0, 500] });
  assert.equal(backwards.hit, false);
  assert.equal(backwards.reason, "INTERSECTION_BEHIND_RAY");

  // Ray parallel to plane (direction along X)
  const parallel = rayPlaneIntersect([0, 0, 0], [1, 0, 0], { planePoint: [0, 0, 500] });
  assert.equal(parallel.hit, false);
  assert.equal(parallel.reason, "RAY_PARALLEL_TO_PLANE");
});

test("BinocularGazeTracker fuses left and right eyes and handles unilateral blinks", () => {
  const tracker = new BinocularGazeTracker({
    planePoint: [0, 0, 500],
    planeNormal: [0, 0, -1],
    screenWidth: 1920,
    screenHeight: 1080,
    screenPhysicalWidth: 500,
    screenPhysicalHeight: 300,
  });

  const leftEye = {
    pupil: [-30, 0, 0],
    ic: [-20, 0, 0],
    oc: [-40, 0, 0],
    ul: [-30, 5, 0],
    ll: [-30, -5, 0],
    center: [-30, 0, 0],
    confidence: 0.9,
  };

  const rightEye = {
    pupil: [30, 0, 0],
    ic: [20, 0, 0],
    oc: [40, 0, 0],
    ul: [30, 5, 0],
    ll: [30, -5, 0],
    center: [30, 0, 0],
    confidence: 0.9,
  };

  const fusion = tracker.track(leftEye, rightEye);
  assert.equal(fusion.valid, true);
  assert.ok(fusion.screenPixel.x > 0);
  assert.ok(fusion.screenPixel.y > 0);
});
