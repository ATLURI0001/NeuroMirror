// gestureReplayRotary.js – bounded ring buffer for gesture replay events
export class GestureReplayRotary {
  #buf = [];
  #size;

  constructor(size = 10) {
    this.#size = size;
  }

  push(event) {
    if (this.#buf.length >= this.#size) this.#buf.shift();
    this.#buf.push(event);
  }

  count() { return this.#buf.length; }
  latest() { return [...this.#buf]; }
}
