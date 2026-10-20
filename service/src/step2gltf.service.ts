import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config';
import type { ConversionOptions, ConversionResult } from './step2gltf.types';

const MAX_LOG_BYTES = 64 * 1024;

class ConversionGate {
  private active = 0;
  private readonly waiters: Array<(release: () => void) => void> = [];

  constructor(
    private readonly limit: number,
    private readonly maxQueue: number,
  ) {}

  load(): { active: number; queued: number } {
    return { active: this.active, queued: this.waiters.length };
  }

  acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.releaseFunction());
    }
    if (this.waiters.length >= this.maxQueue) {
      throw new ServiceUnavailableException('conversion queue is full');
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private releaseFunction(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) {
        next(this.releaseFunction());
      } else {
        this.active -= 1;
      }
    };
  }
}

@Injectable()
export class Step2gltfService implements OnApplicationShutdown {
  private readonly logger = new Logger(Step2gltfService.name);
  private readonly gate = new ConversionGate(
    config.maxConcurrentConversions,
    config.maxQueuedConversions,
  );
  private readonly children = new Set<ChildProcess>();
  private shuttingDown = false;

  load(): { active: number; queued: number } {
    return this.gate.load();
  }

  async assertReady(): Promise<void> {
    const info = await stat(config.step2gltfPath).catch((error: NodeJS.ErrnoException) => {
      throw new Error(`step2gltf is unavailable: ${error.message}`);
    });
    if (!info.isFile()) throw new Error('STEP2GLTF_PATH does not point to a file');
    await access(config.step2gltfPath, constants.X_OK).catch(() => {
      throw new Error('step2gltf is not executable');
    });
    if (this.shuttingDown) throw new Error('service is shutting down');
  }

  async convertUploadedFile(
    uploadedPath: string,
    options: ConversionOptions,
    signal?: AbortSignal,
  ): Promise<ConversionResult> {
    if (this.shuttingDown) throw new ServiceUnavailableException('service is shutting down');
    const release = await this.gate.acquire();
    const conversionId = randomUUID();
    const workDir = join(config.workRoot, conversionId);
    const inputPath = join(workDir, 'input.step');
    const outputPath = join(workDir, 'output.glb');

    try {
      await this.assertReady();
      await mkdir(workDir, { recursive: true, mode: 0o700 });
      await rename(uploadedPath, inputPath);
      const args = this.buildArguments(options, inputPath, outputPath);
      this.logger.log(`conversion started id=${conversionId}`);
      await this.runConverter(args, conversionId, signal);
      const output = await stat(outputPath);
      if (!output.isFile() || output.size < 20) {
        throw new Error('converter did not produce a valid GLB file');
      }
      this.logger.log(`conversion completed id=${conversionId} bytes=${output.size}`);
      return {
        conversionId,
        outputPath,
        cleanup: () => rm(workDir, { recursive: true, force: true }),
      };
    } catch (error) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      await rm(uploadedPath, { force: true }).catch(() => undefined);
      if (error instanceof ServiceUnavailableException) throw error;
      throw new UnprocessableEntityException((error as Error).message);
    } finally {
      release();
    }
  }

  async discardUpload(path: string): Promise<void> {
    await rm(path, { force: true }).catch(() => undefined);
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const child of this.children) child.kill('SIGTERM');
    const deadline = Date.now() + config.shutdownGraceMs;
    while (this.children.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    for (const child of this.children) child.kill('SIGKILL');
  }

  private buildArguments(options: ConversionOptions, input: string, output: string): string[] {
    const args: string[] = [];
    if (options.encoding === 'utf8') args.push('--encoding=UTF-8');
    if (options.encoding === 'gbk' || options.encoding === 'gb2312') args.push('--encoding=GBK');
    if (options.linear !== undefined) args.push(`--linear=${options.linear}`);
    if (options.angular !== undefined) args.push(`--angular=${options.angular}`);
    if (options.preview) args.push('--preview');
    if (options.deepLinear !== undefined) args.push(`--deep-linear=${options.deepLinear}`);
    if (options.deepAngular !== undefined) args.push(`--deep-angular=${options.deepAngular}`);
    if (options.deepRatio !== undefined) args.push(`--deep-ratio=${options.deepRatio}`);
    if (options.deepError !== undefined) args.push(`--deep-error=${options.deepError}`);
    if (options.verbose) args.push('-v');
    args.push(input, output);
    return args;
  }

  private runConverter(args: string[], conversionId: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new Error('conversion cancelled because the client disconnected'));
    }
    return new Promise((resolve, reject) => {
      const child = spawn(config.step2gltfPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
      this.children.add(child);
      let output = '';
      let settled = false;
      let terminationReason: string | undefined;
      let killTimer: NodeJS.Timeout | undefined;

      const append = (chunk: Buffer): void => {
        output = (output + chunk.toString()).slice(-MAX_LOG_BYTES);
      };
      child.stdout?.on('data', append);
      child.stderr?.on('data', append);

      const stop = (reason: string): void => {
        if (settled || terminationReason) return;
        terminationReason = reason;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      };
      const timeout = setTimeout(
        () => stop(`conversion timed out after ${config.conversionTimeoutMs} ms`),
        config.conversionTimeoutMs,
      );
      const abort = (): void => stop('conversion cancelled because the client disconnected');
      signal?.addEventListener('abort', abort, { once: true });

      child.once('error', (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          if (killTimer) clearTimeout(killTimer);
          signal?.removeEventListener('abort', abort);
          this.children.delete(child);
          reject(error);
        }
      });
      child.once('close', (code, processSignal) => {
        clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        signal?.removeEventListener('abort', abort);
        this.children.delete(child);
        if (settled) return;
        settled = true;
        if (terminationReason) {
          reject(new Error(terminationReason));
          return;
        }
        if (code === 0) {
          if (output.trim()) this.logger.debug(`converter id=${conversionId}: ${output.trim()}`);
          resolve();
        } else {
          reject(
            new Error(
              `step2gltf exited with ${code ?? processSignal ?? 'unknown status'}${output.trim() ? `: ${output.trim()}` : ''}`,
            ),
          );
        }
      });
    });
  }
}
