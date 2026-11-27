// NeuroMirror: audio buffer rotary telemetry
export class AudioBufferRotary {
  #buf = [];
  #cap;
  constructor(cap = 8) { this.#cap = cap; }
  record(sample) {
    if (this.#buf.length >= this.#cap) this.#buf.shift();
    this.#buf.push(sample);
  }
  get length() { return this.#buf.length; }
}
