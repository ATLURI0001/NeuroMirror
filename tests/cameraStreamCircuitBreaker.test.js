import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recordStreamError, isStreamOpen, resetStream } from '../assets/js/cameraStreamCircuitBreaker.js';

describe('cameraStreamCircuitBreaker', () => {
  it('opens after threshold errors', () => {
    resetStream();
    recordStreamError(2); recordStreamError(2);
    assert.equal(isStreamOpen(), true);
  });
});
