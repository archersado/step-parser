import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Step2gltfService } from './step2gltf.service';

@Controller('health')
export class HealthController {
  constructor(private readonly converter: Step2gltfService) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ok'; active: number; queued: number }> {
    try {
      await this.converter.assertReady();
    } catch (error) {
      throw new ServiceUnavailableException((error as Error).message);
    }
    const load = this.converter.load();
    return { status: 'ok', ...load };
  }
}
