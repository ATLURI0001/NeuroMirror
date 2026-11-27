export function validateBlendWeight(weight) {
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 1) {
    throw new Error(`Contract violation: blend weight ${weight} out of [0, 1]`);
  }
  return true;
}
