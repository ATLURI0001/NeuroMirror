import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateAvatarRig } from '../assets/js/avatar_rig_contract.js';

describe('avatar_rig_contract', () => {
  it('validates avatar rig fields', () => {
    assert.equal(validateAvatarRig({ skeletonId: 'vrm-1', boneCount: 52 }), true);
    assert.throws(() => validateAvatarRig({ skeletonId: '', boneCount: 0 }));
  });
});
