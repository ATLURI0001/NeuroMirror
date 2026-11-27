// cameraStreamCircuitBreaker.js – circuit breaker for camera stream failures
let failures = 0;
let open = false;

export function recordStreamError(threshold = 3) {
  failures++;
  if (failures >= threshold) open = true;
}

export function isStreamOpen() { return open; }
export function resetStream() { failures = 0; open = false; }
