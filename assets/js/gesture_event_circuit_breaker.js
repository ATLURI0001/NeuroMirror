// NeuroMirror: gesture event circuit breaker
export class GestureEventCircuitBreaker {
  #fails = 0;
  #max;
  #open = false;
  constructor(max = 3) { this.#max = max; }
  process(fn) {
    if (this.#open) throw new Error('gesture circuit open');
    try { const r = fn(); this.#fails = 0; return r; }
    catch (e) { if (++this.#fails >= this.#max) this.#open = true; throw e; }
  }
}
