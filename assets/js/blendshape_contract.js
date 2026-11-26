/**
 * ARKit Facial Blendshape Coefficient Bounds & NaN Contract.
 */
class BlendshapeContract {
  static validate(weights) {
    const errors = [];
    if (!weights || typeof weights !== 'object') {
      return { valid: false, errors: ['ERR_INVALID_WEIGHTS_OBJECT'] };
    }
    for (const [key, val] of Object.entries(weights)) {
      if (!Number.isFinite(val) || val < 0 || val > 1) {
        errors.push(`ERR_COEFFICIENT_OUT_OF_RANGE:${key}`);
      }
    }
    return { valid: errors.length === 0, errors };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BlendshapeContract };
}
