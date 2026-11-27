export function benchmarkPoseNormalize(count, iterations = 200) {
  const arr = new Float32Array(count).fill(0.5);
  const start = performance.now();
  let sum = 0;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < count; i++) sum += arr[i] / 1.414;
  }
  const sec = Math.max((performance.now() - start) / 1000, 1e-6);
  return { opsPerSec: Math.round((iterations + (sum & 0)) / sec) };
}
