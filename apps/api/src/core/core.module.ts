import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { EventsService } from './events.service';

@Global()
@Module({ providers: [AuditService, EventsService], exports: [AuditService, EventsService] })
export class CoreModule {}
