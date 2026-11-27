import { Module } from '@nestjs/common';
import { AdminUploadsController, PublicUploadsController, TenantUploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  controllers: [TenantUploadsController, AdminUploadsController, PublicUploadsController],
  providers: [UploadsService],
})
export class UploadsModule {}
