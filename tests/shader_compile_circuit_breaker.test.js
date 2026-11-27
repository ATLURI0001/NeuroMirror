import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ShaderCompileCircuitBreaker } from '../assets/js/shader_compile_circuit_breaker.js';

describe('ShaderCompileCircuitBreaker', () => {
  it('opens after consecutive failures', () => {
    const cb = new ShaderCompileCircuitBreaker(2, 5000);
    assert.throws(() => cb.call(() => { throw new Error('glsl err'); }));
    assert.throws(() => cb.call(() => { throw new Error('glsl err'); }));
    assert.throws(() => cb.call(() => 'ok'), /circuit open/);
  });
});
