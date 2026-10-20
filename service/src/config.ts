import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export const config = Object.freeze({
  port: positiveInteger('PORT', 3000),
  step2gltfPath: process.env.STEP2GLTF_PATH ?? '/usr/local/bin/step2gltf',
  workRoot: process.env.STEP2GLTF_WORK_DIR ?? join(tmpdir(), 'step2gltf-service'),
  maxUploadBytes: positiveInteger('MAX_UPLOAD_BYTES', 4 * 1024 * 1024 * 1024),
  maxConcurrentConversions: positiveInteger('MAX_CONCURRENT_CONVERSIONS', 1),
  maxQueuedConversions: positiveInteger('MAX_QUEUED_CONVERSIONS', 8),
  conversionTimeoutMs: positiveInteger('CONVERSION_TIMEOUT_MS', 60 * 60 * 1000),
  shutdownGraceMs: positiveInteger('SHUTDOWN_GRACE_MS', 30_000),
});

export function ensureWorkRoot(): void {
  mkdirSync(config.workRoot, { recursive: true, mode: 0o700 });
}
