const samples = [];
const CAP = 32;

export function recordWebcamDrops(drops) {
  if (drops < 0) throw new Error('drops must be non-negative');
  if (samples.length >= CAP) samples.shift();
  samples.push(drops);
}

export function getAvgWebcamDrops() {
  if (!samples.length) return 0;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}
