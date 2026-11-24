import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AccessModule } from './access/access.module';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { CoreModule } from './core/core.module';
import { HealthController } from './health/health.controller';
import { BusinessModulesModule } from './modules/business-modules.module';
import { PrismaModule } from './prisma/prisma.module';
import { TenantModule } from './tenant/tenant.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CoreModule,
    AuthModule,
    AccessModule,
    AdminModule,
    TenantModule,
    BusinessModulesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
