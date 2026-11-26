export function validateAvatarRig(rig) {
  if (!rig || typeof rig !== 'object') throw new Error('Contract violation: rig object required');
  if (!rig.skeletonId || typeof rig.skeletonId !== 'string') throw new Error('Contract violation: skeletonId required');
  if (!Number.isInteger(rig.boneCount) || rig.boneCount <= 0) throw new Error('Contract violation: boneCount must be > 0');
  return true;
}
