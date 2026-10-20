import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { Step2gltfController } from './step2gltf.controller';
import { Step2gltfService } from './step2gltf.service';

@Module({
  controllers: [HealthController, Step2gltfController],
  providers: [Step2gltfService],
})
export class AppModule {}
