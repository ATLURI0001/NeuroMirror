const RING_SIZE = 32;
const samples = [];

export function recordFrameJitter(jitterMs) {
  if (typeof jitterMs !== 'number' || jitterMs < 0) {
    throw new Error('jitterMs must be a non-negative number');
  }
  if (samples.length >= RING_SIZE) samples.shift();
  samples.push(jitterMs);
}

export function getJitterStats() {
  if (samples.length === 0) return { count: 0, avgMs: 0, maxMs: 0 };
  const sum = samples.reduce((a, b) => a + b, 0);
  return {
    count: samples.length,
    avgMs: sum / samples.length,
    maxMs: Math.max(...samples),
  };
}
