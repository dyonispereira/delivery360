import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from '@nestjs/config';
import { AccessModule } from './access/access.module';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { CoreModule } from './core/core.module';
import { HealthController } from './health/health.controller';
import { CardapioModule } from './cardapio/cardapio.module';
import { PaymentsModule } from './payments/payments.module';
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
    PaymentsModule,
    CardapioModule,
    // Limite geral generoso; rotas públicas sensíveis têm limite próprio (@Throttle).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: process.env.NODE_ENV === 'test' ? 10_000 : 300 }]),
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
