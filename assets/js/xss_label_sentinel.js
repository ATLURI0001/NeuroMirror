export function assertSafeAvatarLabel(label) {
  if (/[<>]/.test(label)) {
    throw new Error('Sentinel violation: HTML angle brackets prohibited in avatar label');
  }
}
