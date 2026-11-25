import { Module } from '@nestjs/common';
import { CourierPublicController, EntregasManageController } from './entregas.controller';
import { EntregasService } from './entregas.service';

@Module({
  controllers: [EntregasManageController, CourierPublicController],
  providers: [EntregasService],
})
export class EntregasModule {}
