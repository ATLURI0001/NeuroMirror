import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeAvatarLabel } from '../assets/js/xss_label_sentinel.js';

describe('xss_label_sentinel', () => {
  it('accepts safe labels and rejects HTML tags', () => {
    assert.doesNotThrow(() => assertSafeAvatarLabel('Avatar Alpha'));
    assert.throws(() => assertSafeAvatarLabel('<script>alert(1)</script>'));
  });
});
