// frameDropSentinel.js – detects excessive dropped gesture frames
export class FrameDropSentinel {
  #maxDrops;
  #alerts = 0;

  constructor(maxDrops = 5) {
    this.#maxDrops = maxDrops;
  }

  check(drops) {
    if (drops > this.#maxDrops) {
      this.#alerts++;
      return false;
    }
    return true;
  }

  alerts() { return this.#alerts; }
}
