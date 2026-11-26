export function assertValidPoseLandmarks(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length === 0) {
    throw new Error('Sentinel violation: landmarks array must be non-empty');
  }
  for (const lm of landmarks) {
    if (!Number.isFinite(lm.x) || !Number.isFinite(lm.y)) {
      throw new Error('Sentinel violation: NaN or Infinity in pose landmark coordinates');
    }
  }
}
