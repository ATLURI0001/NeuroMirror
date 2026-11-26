const samples = [];
const CAP = 32;

export function recordRenderFps(fps) {
  if (fps < 0) throw new Error('fps must be non-negative');
  if (samples.length >= CAP) samples.shift();
  samples.push(fps);
}

export function getAvgFps() {
  if (!samples.length) return 0;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}
