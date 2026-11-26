const test = require('node:test');
const assert = require('node:assert/strict');
const { MeshBufferSentinel } = require('../assets/js/mesh_buffer_sentinel.js');

test('MeshBufferSentinel - allocates and disposes buffers cleanly', () => {
  const sentinel = new MeshBufferSentinel(10, 1024 * 1024);
  const res = sentinel.allocateBuffer('face-vbo-1', 4096, 1);
  assert.equal(res.allowed, true);
  assert.equal(res.activeCount, 1);
  assert.equal(res.totalBytes, 4096);

  const disposed = sentinel.disposeBuffer('face-vbo-1');
  assert.equal(disposed, true);
  assert.equal(sentinel.totalAllocatedBytes, 0);
});

test('MeshBufferSentinel - rejects VRAM budget overrun', () => {
  const sentinel = new MeshBufferSentinel(10, 8000);
  sentinel.allocateBuffer('vbo-1', 5000, 1);
  const res = sentinel.allocateBuffer('vbo-2', 4000, 2);
  assert.equal(res.allowed, false);
  assert.equal(res.reason, 'ERR_VRAM_BUDGET_EXCEEDED');
});

test('MeshBufferSentinel - detects orphaned stale mesh buffers', () => {
  const sentinel = new MeshBufferSentinel(10, 1024 * 1024);
  sentinel.allocateBuffer('stale-vbo', 1024, 10);
  sentinel.allocateBuffer('fresh-vbo', 1024, 180);

  const orphans = sentinel.detectOrphans(200, 100);
  assert.deepEqual(orphans, ['stale-vbo']);
  assert.equal(sentinel.incidentLog.length, 1);
});
