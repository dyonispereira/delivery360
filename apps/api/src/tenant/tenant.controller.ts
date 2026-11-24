import { Controller, Get } from '@nestjs/common';
import { CurrentTenant, TenantScoped } from '../access/access.decorators';
import type { TenantContext } from '../access/access.types';
import { PrismaService } from '../prisma/prisma.service';

/** Dados do restaurante atual (cabeçalho x-tenant-id), usados para montar o menu da web e dos apps. */
@TenantScoped()
@Controller('tenant')
export class TenantController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('context')
  async context(@CurrentTenant() tenant: TenantContext) {
    const t = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenant.tenantId },
      select: { id: true, name: true, status: true },
    });
    return { ...t, role: tenant.role, activeModules: tenant.activeModules };
  }
}
