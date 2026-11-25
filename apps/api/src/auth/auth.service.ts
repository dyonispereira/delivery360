import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { LoginResponse, MeResponse, MeTenant } from '@delivery360/shared';
import { PrismaService } from '../prisma/prisma.service';
import { activeModuleCodes } from '../access/access.rules';
import type { JwtPayload } from '../access/access.types';

const tenantSelect = {
  id: true,
  name: true,
  status: true,
  modules: { select: { moduleCode: true, active: true, startsAt: true, endsAt: true } },
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string): Promise<LoginResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    // Mesma mensagem para e-mail e senha errados, para não revelar quem tem conta.
    const ok = user && user.active && (await bcrypt.compare(password, user.passwordHash));
    if (!ok || !user) throw new UnauthorizedException('E-mail ou senha incorretos.');

    const payload: JwtPayload = { sub: user.id, staffRole: user.staffRole };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken, user: await this.me(user.id) };
  }

  /** Dados do usuário logado e dos restaurantes que ele acessa, com os módulos ativos de cada um. */
  async me(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        staffRole: true,
        memberships: { select: { role: true, tenant: { select: tenantSelect } } },
        managedTenants: { select: { tenant: { select: tenantSelect } } },
      },
    });

    const byId = new Map<string, MeTenant>();
    for (const m of user.memberships) {
      byId.set(m.tenant.id, {
        id: m.tenant.id,
        name: m.tenant.name,
        status: m.tenant.status,
        role: m.role,
        activeModules: activeModuleCodes(m.tenant.modules),
      });
    }
    if (user.staffRole === 'ACCOUNT_MANAGER') {
      for (const { tenant } of user.managedTenants) {
        if (byId.has(tenant.id)) continue;
        byId.set(tenant.id, {
          id: tenant.id,
          name: tenant.name,
          status: tenant.status,
          role: null,
          activeModules: activeModuleCodes(tenant.modules),
        });
      }
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      staffRole: user.staffRole,
      tenants: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    };
  }
}
