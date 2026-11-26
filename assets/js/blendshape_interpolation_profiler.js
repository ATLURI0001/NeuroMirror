/**
 * 52-Channel ARKit Facial Blendshape Interpolation Benchmark Profiler.
 * 
 * Benchmarks typed Float32Array linear interpolation (lerp) across
 * 52 facial expression channels at 60fps/120fps render loops.
 */

class BlendshapeInterpolationProfiler {
  constructor(channelCount = 52) {
    this.channelCount = channelCount;
    this.current = new Float32Array(channelCount);
    this.target = new Float32Array(channelCount);
  }

  lerpFrame(alpha) {
    const inv = 1.0 - alpha;
    for (let i = 0; i < this.channelCount; i++) {
      this.current[i] = this.current[i] * inv + this.target[i] * alpha;
    }
  }

  runBenchmark(frames = 1000, iterations = 20) {
    for (let i = 0; i < this.channelCount; i++) {
      this.target[i] = (i % 10) * 0.1;
    }

    const latenciesMicros = [];
    const tStart = performance.now();

    for (let iter = 0; iter < iterations; iter++) {
      const start = performance.now();
      for (let f = 0; f < frames; f++) {
        this.lerpFrame(0.25);
      }
      latenciesMicros.push(((performance.now() - start) * 1000) / frames);
    }

    const totalSec = (performance.now() - tStart) / 1000;
    latenciesMicros.sort((a, b) => a - b);

    return {
      channelCount: this.channelCount,
      p50Micros: Number(latenciesMicros[Math.floor(iterations * 0.5)].toFixed(3)),
      p90Micros: Number(latenciesMicros[Math.floor(iterations * 0.9)].toFixed(3)),
      throughputFramesSec: Math.round((frames * iterations) / Math.max(1e-6, totalSec)),
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BlendshapeInterpolationProfiler };
}
