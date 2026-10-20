import {
  BadRequestException,
  Controller,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { diskStorage } from 'multer';
import { config } from './config';
import { Step2gltfService } from './step2gltf.service';
import type { ConversionOptions, SourceEncoding } from './step2gltf.types';

function parsePositive(
  name: string,
  raw: string | undefined,
  upper?: number,
  exclusiveUpper = false,
): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  const aboveUpper = upper !== undefined && (exclusiveUpper ? value >= upper : value > upper);
  if (!Number.isFinite(value) || value <= 0 || aboveUpper) {
    const bound = upper
      ? exclusiveUpper
        ? ` less than ${upper}`
        : ` no greater than ${upper}`
      : '';
    throw new BadRequestException(`${name} must be a positive number${bound}`);
  }
  return value;
}

function parseBoolean(name: string, raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new BadRequestException(`${name} must be true, false, 1, or 0`);
}

@Controller()
export class Step2gltfController {
  constructor(private readonly converter: Step2gltfService) {}

  @Post('step2gltf')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: config.workRoot,
        filename: (_request, _file, callback) => callback(null, `upload-${randomUUID()}.step`),
      }),
      limits: { files: 1, fileSize: config.maxUploadBytes },
      fileFilter: (_request, file, callback) => {
        const extension = extname(file.originalname).toLowerCase();
        callback(
          extension === '.step' || extension === '.stp'
            ? null
            : new BadRequestException('file must have a .step or .stp extension'),
          extension === '.step' || extension === '.stp',
        );
      },
    }),
  )
  async convert(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: Request,
    @Res() response: Response,
    @Query() query: Record<string, string | undefined>,
  ): Promise<void> {
    if (!file) throw new BadRequestException('multipart field "file" is required');
    const abortController = new AbortController();
    const abortOnDisconnect = (): void => {
      if (!response.writableEnded) abortController.abort();
    };
    response.once('close', abortOnDisconnect);

    try {
      const options = this.parseOptions(query);
      const result = await this.converter.convertUploadedFile(file.path, options, abortController.signal);
      const outputName = `${basename(file.originalname, extname(file.originalname))}.glb`
        .replace(/["\\\r\n]/g, '_');
      const asciiOutputName = outputName.replace(/[^\x20-\x7e]/g, '_');
      const encodedOutputName = encodeURIComponent(outputName).replace(/['()]/g, (character) =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      );
      response.status(200);
      response.setHeader('Content-Type', 'model/gltf-binary');
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="${asciiOutputName}"; filename*=UTF-8''${encodedOutputName}`,
      );
      response.setHeader('X-Conversion-Id', result.conversionId);
      const outputInfo = await stat(result.outputPath);
      response.setHeader('Content-Length', String(outputInfo.size));
      let rejectDownload: (reason: Error) => void = () => undefined;
      const downloadClosed = (): void => {
        if (!response.writableEnded) rejectDownload(new Error('client disconnected while downloading the GLB'));
      };
      await new Promise<void>((resolve, reject) => {
        rejectDownload = reject;
        const stream = createReadStream(result.outputPath);
        stream.once('error', reject);
        response.once('finish', resolve);
        response.once('error', reject);
        response.once('close', downloadClosed);
        stream.pipe(response);
      }).finally(async () => {
        response.removeListener('close', downloadClosed);
        await result.cleanup();
      });
    } finally {
      response.removeListener('close', abortOnDisconnect);
      await this.converter.discardUpload(file.path);
    }
  }

  private parseOptions(query: Record<string, string | undefined>): ConversionOptions {
    const encoding = query.encoding?.toLowerCase();
    if (encoding && !['gbk', 'gb2312', 'utf8', 'none'].includes(encoding)) {
      throw new BadRequestException('encoding must be gbk, gb2312, utf8, or none');
    }
    const preview = parseBoolean('preview', query.preview) ?? false;
    const deepLinear = query.deepLinear ?? query['deep-linear'];
    const deepAngular = query.deepAngular ?? query['deep-angular'];
    const deepRatio = query.deepRatio ?? query['deep-ratio'];
    const deepError = query.deepError ?? query['deep-error'];
    const options: ConversionOptions = {
      encoding: encoding as SourceEncoding | undefined,
      linear: parsePositive('linear', query.linear),
      angular: parsePositive('angular', query.angular, Math.PI, true),
      preview,
      deepLinear: parsePositive('deepLinear', deepLinear),
      deepAngular: parsePositive('deepAngular', deepAngular, Math.PI, true),
      deepRatio: parsePositive('deepRatio', deepRatio, 1),
      deepError: parsePositive('deepError', deepError, 1),
      verbose: parseBoolean('verbose', query.verbose) ?? false,
    };
    if (!preview && [options.deepLinear, options.deepAngular, options.deepRatio, options.deepError].some((v) => v !== undefined)) {
      throw new BadRequestException('deep* parameters require preview=true');
    }
    return options;
  }
}
