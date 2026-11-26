/**
 * INC-2026-NEURO-3318: WebGL Face Mesh Vertex Buffer Leak & Orphaned Geometry Sentinel.
 * 
 * Detects undisposed WebGL vertex/index buffers, orphaned mesh allocations across
 * avatar expression transitions, and prevents GPU VRAM OOM crashes.
 */

class MeshBufferSentinel {
  constructor(maxActiveBuffers = 64, maxMemoryBytes = 64 * 1024 * 1024) {
    this.maxActiveBuffers = maxActiveBuffers;
    this.maxMemoryBytes = maxMemoryBytes;
    this.activeBuffers = new Map();
    this.totalAllocatedBytes = 0;
    this.incidentLog = [];
  }

  allocateBuffer(bufferId, byteLength, frameIndex) {
    if (!bufferId || byteLength <= 0) {
      throw new Error('Invalid buffer allocation parameters');
    }

    if (this.activeBuffers.has(bufferId)) {
      this._recordIncident('ERR_DUPLICATE_BUFFER_ALLOCATION', bufferId, { frameIndex });
      return { allowed: false, reason: 'ERR_DUPLICATE_BUFFER_ALLOCATION' };
    }

    if (this.activeBuffers.size >= this.maxActiveBuffers) {
      this._recordIncident('ERR_BUFFER_COUNT_EXCEEDED', bufferId, { count: this.activeBuffers.size });
      return { allowed: false, reason: 'ERR_BUFFER_COUNT_EXCEEDED' };
    }

    if (this.totalAllocatedBytes + byteLength > this.maxMemoryBytes) {
      this._recordIncident('ERR_VRAM_BUDGET_EXCEEDED', bufferId, {
        projectedBytes: this.totalAllocatedBytes + byteLength,
        maxBytes: this.maxMemoryBytes,
      });
      return { allowed: false, reason: 'ERR_VRAM_BUDGET_EXCEEDED' };
    }

    this.activeBuffers.set(bufferId, { bufferId, byteLength, allocatedAtFrame: frameIndex });
    this.totalAllocatedBytes += byteLength;
    return { allowed: true, activeCount: this.activeBuffers.size, totalBytes: this.totalAllocatedBytes };
  }

  disposeBuffer(bufferId) {
    const entry = this.activeBuffers.get(bufferId);
    if (!entry) return false;
    this.totalAllocatedBytes -= entry.byteLength;
    this.activeBuffers.delete(bufferId);
    return true;
  }

  detectOrphans(currentFrame, staleFrameThreshold = 120) {
    const orphans = [];
    for (const [id, entry] of this.activeBuffers.entries()) {
      if (currentFrame - entry.allocatedAtFrame > staleFrameThreshold) {
        orphans.push(id);
      }
    }
    if (orphans.length > 0) {
      this._recordIncident('ERR_ORPHANED_MESH_BUFFERS_DETECTED', orphans.join(','), {
        orphanCount: orphans.length,
        currentFrame,
      });
    }
    return orphans;
  }

  _recordIncident(code, target, metadata) {
    this.incidentLog.push({ timestamp: Date.now(), code, target, metadata });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MeshBufferSentinel };
}
