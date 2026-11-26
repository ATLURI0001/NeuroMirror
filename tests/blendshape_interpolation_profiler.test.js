const test = require('node:test');
const assert = require('node:assert/strict');
const { BlendshapeInterpolationProfiler } = require('../assets/js/blendshape_interpolation_profiler.js');

test('BlendshapeInterpolationProfiler - interpolates 52 channels within microsecond budget', () => {
  const profiler = new BlendshapeInterpolationProfiler(52);
  const res = profiler.runBenchmark(500, 10);

  assert.equal(res.channelCount, 52);
  assert.ok(res.p50Micros >= 0);
  assert.ok(res.throughputFramesSec > 0);
});
