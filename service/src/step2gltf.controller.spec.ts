import { BadRequestException } from '@nestjs/common';
import { Step2gltfController } from './step2gltf.controller';
import { Step2gltfService } from './step2gltf.service';

describe('Step2gltfController options', () => {
  const controller = new Step2gltfController({} as Step2gltfService);
  const parse = (query: Record<string, string | undefined>) =>
    (controller as unknown as { parseOptions: (input: Record<string, string | undefined>) => unknown })
      .parseOptions(query);

  it('maps the complete preview option set', () => {
    expect(
      parse({
        encoding: 'utf8',
        preview: 'true',
        linear: '0.1',
        angular: '0.5',
        'deep-linear': '1',
        'deep-angular': '0.8',
        'deep-ratio': '0.15',
        'deep-error': '0.001',
      }),
    ).toEqual({
      encoding: 'utf8',
      preview: true,
      linear: 0.1,
      angular: 0.5,
      deepLinear: 1,
      deepAngular: 0.8,
      deepRatio: 0.15,
      deepError: 0.001,
      verbose: false,
    });
  });

  it('rejects deep options unless preview mode is enabled', () => {
    expect(() => parse({ deepRatio: '0.2' })).toThrow(BadRequestException);
  });

  it('rejects unsafe or unsupported values', () => {
    expect(() => parse({ encoding: 'latin1' })).toThrow(BadRequestException);
    expect(() => parse({ angular: String(Math.PI) })).toThrow(BadRequestException);
    expect(() => parse({ preview: 'yes' })).toThrow(BadRequestException);
  });
});
