// Copyright (c) 2026 NeuroMirror Contributors
// SPDX-License-Identifier: MIT
// Biometric Gaze Vector Estimator & 3D Pupil-Iris Ray-Casting Projection Engine.

/**
 * Validates 3D coordinate vector [x, y, z].
 * @param {Array<number>} v
 * @returns {Array<number>}
 */
function sanitizeVec3(v, fallback = [0, 0, 0]) {
  if (!Array.isArray(v) || v.length < 3) return [...fallback];
  return [
    Number.isFinite(v[0]) ? v[0] : fallback[0],
    Number.isFinite(v[1]) ? v[1] : fallback[1],
    Number.isFinite(v[2]) ? v[2] : fallback[2],
  ];
}

/**
 * Vector magnitude (Euclidean norm).
 */
export function vec3Magnitude(v) {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/**
 * Normalize 3D vector to unit length with division-by-zero protection.
 */
export function vec3Normalize(v, fallback = [0, 0, 1]) {
  const mag = vec3Magnitude(v);
  if (mag < 1e-9 || !Number.isFinite(mag)) {
    return [...fallback];
  }
  return [v[0] / mag, v[1] / mag, v[2] / mag];
}

/**
 * Dot product of two 3D vectors.
 */
export function vec3Dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Normalizes pupil position within eye bounding landmarks.
 * Calculates normalized horizontal ratio (u) and vertical aperture ratio (v).
 *
 * @param {Array<number>} pupil - [x, y, z] pupil center
 * @param {Array<number>} innerCanthus - [x, y, z] medial eye corner
 * @param {Array<number>} outerCanthus - [x, y, z] lateral eye corner
 * @param {Array<number>} upperLid - [x, y, z] superior eyelid margin
 * @param {Array<number>} lowerLid - [x, y, z] inferior eyelid margin
 * @param {object} [options]
 * @param {number} [options.minApertureThreshold=1.5] - Minimum vertical distance before blink detection
 * @returns {{ u: number, v: number, aperture: number, blinkDetected: boolean, valid: boolean }}
 */
export function normalizePupilCoordinates(
  pupil,
  innerCanthus,
  outerCanthus,
  upperLid,
  lowerLid,
  options = {}
) {
  const minAperture = options.minApertureThreshold ?? 1.5;

  const p = sanitizeVec3(pupil);
  const ic = sanitizeVec3(innerCanthus);
  const oc = sanitizeVec3(outerCanthus);
  const ul = sanitizeVec3(upperLid);
  const ll = sanitizeVec3(lowerLid);

  // Horizontal canthus vector
  const cAxis = [oc[0] - ic[0], oc[1] - ic[1], oc[2] - ic[2]];
  const cLenSq = vec3Dot(cAxis, cAxis);

  // Vertical eyelid vector
  const vAxis = [ul[0] - ll[0], ul[1] - ll[1], ul[2] - ll[2]];
  const aperture = vec3Magnitude(vAxis);

  if (cLenSq < 1e-6 || !Number.isFinite(cLenSq)) {
    return { u: 0.5, v: 0.5, aperture: 0, blinkDetected: true, valid: false };
  }

  // Check for blink / occlusion
  if (aperture < minAperture) {
    return { u: 0.5, v: 0.5, aperture, blinkDetected: true, valid: true };
  }

  // Project pupil onto horizontal canthal axis
  const pVecH = [p[0] - ic[0], p[1] - ic[1], p[2] - ic[2]];
  const rawU = vec3Dot(pVecH, cAxis) / cLenSq;
  const u = Math.max(0.0, Math.min(1.0, rawU));

  // Project pupil onto vertical aperture axis
  const pVecV = [p[0] - ll[0], p[1] - ll[1], p[2] - ll[2]];
  const vLenSq = vec3Dot(vAxis, vAxis);
  const rawV = vLenSq > 1e-6 ? vec3Dot(pVecV, vAxis) / vLenSq : 0.5;
  const v = Math.max(0.0, Math.min(1.0, rawV));

  return {
    u: Math.round(u * 1e4) / 1e4,
    v: Math.round(v * 1e4) / 1e4,
    aperture: Math.round(aperture * 1e4) / 1e4,
    blinkDetected: false,
    valid: true,
  };
}

/**
 * Estimates 3D gaze ray from normalized pupil ratios and eyeball center.
 *
 * @param {{ u: number, v: number }} pupilNorm - Normalized ratios in [0, 1]
 * @param {Array<number>} eyeballCenter - [x, y, z] center of rotation
 * @param {object} [options]
 * @param {number} [options.maxPitchAngle=0.6] - Maximum vertical angle excursion in radians (~35 deg)
 * @param {number} [options.maxYawAngle=0.8] - Maximum horizontal angle excursion in radians (~45 deg)
 * @returns {{ origin: Array<number>, direction: Array<number>, yawRad: number, pitchRad: number }}
 */
export function estimateGazeRay3D(pupilNorm, eyeballCenter, options = {}) {
  const maxPitch = options.maxPitchAngle ?? 0.6;
  const maxYaw = options.maxYawAngle ?? 0.8;

  const center = sanitizeVec3(eyeballCenter);
  const u = Number.isFinite(pupilNorm.u) ? Math.max(0, Math.min(1, pupilNorm.u)) : 0.5;
  const v = Number.isFinite(pupilNorm.v) ? Math.max(0, Math.min(1, pupilNorm.v)) : 0.5;

  // Center offset in [-1, 1]
  const offsetU = (u - 0.5) * 2.0;
  const offsetV = (v - 0.5) * 2.0;

  let yawRad = offsetU * maxYaw;
  let pitchRad = -offsetV * maxPitch; // Invert so looking up is positive Y

  if (Object.is(yawRad, -0)) yawRad = 0;
  if (Object.is(pitchRad, -0)) pitchRad = 0;

  // Construct spherical ray direction: forward is +Z, right is +X, up is +Y
  const cosPitch = Math.cos(pitchRad);
  const sinPitch = Math.sin(pitchRad);
  const cosYaw = Math.cos(yawRad);
  const sinYaw = Math.sin(yawRad);

  const rawDir = [
    sinYaw * cosPitch,
    sinPitch,
    cosYaw * cosPitch,
  ];

  const direction = vec3Normalize(rawDir);

  return {
    origin: center,
    direction,
    yawRad: Math.round(yawRad * 1e4) / 1e4,
    pitchRad: Math.round(pitchRad * 1e4) / 1e4,
  };
}

/**
 * Computes intersection of 3D gaze ray with virtual display viewport plane.
 *
 * @param {Array<number>} rayOrigin - [x, y, z]
 * @param {Array<number>} rayDirection - [dx, dy, dz]
 * @param {object} planeConfig
 * @param {Array<number>} [planeConfig.planePoint=[0, 0, 500]] - Point on display plane in mm
 * @param {Array<number>} [planeConfig.planeNormal=[0, 0, -1]] - Plane surface normal vector
 * @param {number} [planeConfig.screenWidth=1920] - Screen pixel width
 * @param {number} [planeConfig.screenHeight=1080] - Screen pixel height
 * @param {number} [planeConfig.screenPhysicalWidth=500] - Physical width in mm
 * @param {number} [planeConfig.screenPhysicalHeight=300] - Physical height in mm
 * @returns {{ hit: boolean, point3D?: Array<number>, screenPixel?: { x: number, y: number }, distance?: number, reason?: string }}
 */
export function rayPlaneIntersect(rayOrigin, rayDirection, planeConfig = {}) {
  const o = sanitizeVec3(rayOrigin);
  const d = vec3Normalize(rayDirection);

  const pPoint = sanitizeVec3(planeConfig.planePoint, [0, 0, 500]);
  const pNormal = vec3Normalize(sanitizeVec3(planeConfig.planeNormal, [0, 0, -1]));

  const screenW = planeConfig.screenWidth ?? 1920;
  const screenH = planeConfig.screenHeight ?? 1080;
  const physW = planeConfig.screenPhysicalWidth ?? 500;
  const physH = planeConfig.screenPhysicalHeight ?? 300;

  const denom = vec3Dot(d, pNormal);

  // Parallel check (|denom| near zero)
  if (Math.abs(denom) < 1e-6) {
    return { hit: false, reason: "RAY_PARALLEL_TO_PLANE" };
  }

  // Intersection scalar: t = (P0 - O) . N / (D . N)
  const diff = [pPoint[0] - o[0], pPoint[1] - o[1], pPoint[2] - o[2]];
  const t = vec3Dot(diff, pNormal) / denom;

  if (t <= 0 || !Number.isFinite(t)) {
    return { hit: false, reason: "INTERSECTION_BEHIND_RAY" };
  }

  const hitPoint = [
    o[0] + t * d[0],
    o[1] + t * d[1],
    o[2] + t * d[2],
  ];

  // Map 3D coordinate relative to plane center into 2D screen pixels
  const relX = hitPoint[0] - pPoint[0];
  const relY = hitPoint[1] - pPoint[1];

  const normX = relX / physW + 0.5;
  const normY = 0.5 - relY / physH; // Flip Y for screen pixel coordinates

  const pixelX = Math.round(normX * screenW);
  const pixelY = Math.round(normY * screenH);

  return {
    hit: true,
    point3D: [
      Math.round(hitPoint[0] * 100) / 100,
      Math.round(hitPoint[1] * 100) / 100,
      Math.round(hitPoint[2] * 100) / 100,
    ],
    screenPixel: {
      x: pixelX,
      y: pixelY,
    },
    distance: Math.round(t * 100) / 100,
  };
}

/**
 * Cyclopean Gaze Integrator combining binocular observations.
 */
export class BinocularGazeTracker {
  constructor(displayConfig = {}) {
    this.displayConfig = displayConfig;
  }

  /**
   * Estimates fused binocular focus point from left and right eye measurements.
   * @param {object} leftEyeData - { pupil, ic, oc, ul, ll, center, confidence }
   * @param {object} rightEyeData - { pupil, ic, oc, ul, ll, center, confidence }
   */
  track(leftEyeData, rightEyeData) {
    const leftNorm = normalizePupilCoordinates(
      leftEyeData.pupil,
      leftEyeData.ic,
      leftEyeData.oc,
      leftEyeData.ul,
      leftEyeData.ll
    );

    const rightNorm = normalizePupilCoordinates(
      rightEyeData.pupil,
      rightEyeData.ic,
      rightEyeData.oc,
      rightEyeData.ul,
      rightEyeData.ll
    );

    const leftRay = estimateGazeRay3D(leftNorm, leftEyeData.center);
    const rightRay = estimateGazeRay3D(rightNorm, rightEyeData.center);

    const leftHit = rayPlaneIntersect(leftRay.origin, leftRay.direction, this.displayConfig);
    const rightHit = rayPlaneIntersect(rightRay.origin, rightRay.direction, this.displayConfig);

    const leftWeight = (!leftNorm.blinkDetected && leftHit.hit) ? (leftEyeData.confidence ?? 1.0) : 0.0;
    const rightWeight = (!rightNorm.blinkDetected && rightHit.hit) ? (rightEyeData.confidence ?? 1.0) : 0.0;
    const totalWeight = leftWeight + rightWeight;

    if (totalWeight <= 0) {
      return {
        valid: false,
        blink: leftNorm.blinkDetected && rightNorm.blinkDetected,
        reason: "NO_VALID_BINOCULAR_TRACKING",
      };
    }

    const pixelX = Math.round(
      ((leftHit.screenPixel?.x ?? 0) * leftWeight + (rightHit.screenPixel?.x ?? 0) * rightWeight) / totalWeight
    );
    const pixelY = Math.round(
      ((leftHit.screenPixel?.y ?? 0) * leftWeight + (rightHit.screenPixel?.y ?? 0) * rightWeight) / totalWeight
    );

    return {
      valid: true,
      screenPixel: { x: pixelX, y: pixelY },
      leftGaze: { ray: leftRay, hit: leftHit, blink: leftNorm.blinkDetected },
      rightGaze: { ray: rightRay, hit: rightHit, blink: rightNorm.blinkDetected },
    };
  }
}
