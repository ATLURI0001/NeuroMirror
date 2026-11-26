export function benchmarkMeshBlend(vertexCount, iterations = 100) {
  const weights = new Float32Array(vertexCount).fill(0.5);
  const start = performance.now();
  let sum = 0;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < vertexCount; i++) sum += weights[i] * 2.0;
  }
  const sec = Math.max((performance.now() - start) / 1000, 1e-6);
  return { opsPerSec: Math.round((iterations + (sum & 0)) / sec) };
}
