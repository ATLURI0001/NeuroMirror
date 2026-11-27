// NeuroMirror: input latency sentinel
export class InputLatencySentinel {
  #threshold;
  constructor(thresholdMs = 50) { this.#threshold = thresholdMs; }
  check(latencyMs) {
    if (latencyMs > this.#threshold) {
      throw new Error(`input latency exceeded: ${latencyMs}ms > ${this.#threshold}ms`);
    }
  }
}
