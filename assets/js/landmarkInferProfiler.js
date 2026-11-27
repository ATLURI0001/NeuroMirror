// landmarkInferProfiler.js – tracks landmark inference latencies
export class LandmarkInferProfiler {
  #samples = [];

  record(ms) {
    this.#samples.push(ms);
  }

  avgMs() {
    if (!this.#samples.length) return 0;
    return this.#samples.reduce((a, b) => a + b, 0) / this.#samples.length;
  }
}
