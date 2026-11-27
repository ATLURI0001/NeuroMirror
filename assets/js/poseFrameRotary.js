// poseFrameRotary.js – bounded ring buffer for pose frame timestamps
export class PoseFrameRotary {
  #buf = [];
  #max;

  constructor(max = 12) {
    this.#max = max;
  }

  push(ts) {
    if (this.#buf.length >= this.#max) this.#buf.shift();
    this.#buf.push(ts);
  }

  count() { return this.#buf.length; }
}
