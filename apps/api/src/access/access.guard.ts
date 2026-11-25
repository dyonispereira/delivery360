import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { ModuleCode, StaffRole, TenantRole } from '@delivery360/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  IS_PUBLIC,
  REQUIRED_MODULE,
  STAFF_ROLES_KEY,
  TENANT_ROLES_KEY,
  TENANT_SCOPED,
} from './access.decorators';
import { activeModuleCodes, hasTenantRole, resolveTenantAccess } from './access.rules';
import { AuthUser, JwtPayload, TENANT_HEADER, TenantContext } from './access.types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AppRequest = Request & { user?: AuthUser; tenant?: TenantContext };

/**
 * Guard único (global) que aplica, nesta ordem:
 * 1. login (JWT), exceto rotas @Public;
 * 2. @StaffOnly: só a nossa equipe;
 * 3. restaurante (cabeçalho x-tenant-id) para @TenantScoped, @RequireModule e @TenantRoles;
 * 4. @RequireModule: a chave do módulo precisa estar ligada para o restaurante;
 * 5. @TenantRoles: papel do usuário no restaurante.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  private meta<T>(key: string, ctx: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.meta<boolean>(IS_PUBLIC, ctx)) return true;

    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const user = await this.authenticate(req);
    req.user = user;

    const staffRoles = this.meta<StaffRole[]>(STAFF_ROLES_KEY, ctx);
    if (staffRoles) {
      if (!user.staffRole) throw new ForbiddenException('Acesso restrito à equipe.');
      if (staffRoles.length > 0 && !staffRoles.includes(user.staffRole)) {
        throw new ForbiddenException('Seu perfil não pode fazer esta ação.');
      }
    }

    const requiredModule = this.meta<ModuleCode>(REQUIRED_MODULE, ctx);
    const tenantRoles = this.meta<TenantRole[]>(TENANT_ROLES_KEY, ctx);
    const tenantScoped = this.meta<boolean>(TENANT_SCOPED, ctx) || !!requiredModule || !!tenantRoles;
    if (!tenantScoped) return true;

    const tenant = await this.resolveTenant(req, user);
    req.tenant = tenant;

    if (requiredModule && !tenant.activeModules.includes(requiredModule)) {
      throw new ForbiddenException(`O módulo "${requiredModule}" não está ativo para este restaurante.`);
    }
    if (tenantRoles && !hasTenantRole(user.staffRole, tenant.role, tenantRoles)) {
      throw new ForbiddenException('Seu perfil neste restaurante não pode fazer esta ação.');
    }
    return true;
  }

  private async authenticate(req: AppRequest): Promise<AuthUser> {
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Faça login.');

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }

    // Confere no banco a cada requisição: usuário desativado perde o acesso na hora.
    const dbUser = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, active: true, staffRole: true },
    });
    if (!dbUser || !dbUser.active) throw new UnauthorizedException('Usuário inativo.');
    return { id: dbUser.id, staffRole: dbUser.staffRole };
  }

  private async resolveTenant(req: AppRequest, user: AuthUser): Promise<TenantContext> {
    const raw = req.headers[TENANT_HEADER];
    const tenantId = Array.isArray(raw) ? raw[0] : raw;
    if (!tenantId) throw new BadRequestException(`Informe o restaurante no cabeçalho ${TENANT_HEADER}.`);
    if (!UUID_RE.test(tenantId)) throw new BadRequestException('Restaurante inválido.');

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        status: true,
        modules: { select: { moduleCode: true, active: true, startsAt: true, endsAt: true } },
        memberships: { where: { userId: user.id }, select: { role: true } },
        accountManagers: { where: { userId: user.id }, select: { userId: true } },
      },
    });
    if (!tenant) throw new ForbiddenException('Sem acesso a este restaurante.');

    const access = resolveTenantAccess({
      staffRole: user.staffRole,
      membershipRole: tenant.memberships[0]?.role ?? null,
      isAssignedAccountManager: tenant.accountManagers.length > 0,
      tenantStatus: tenant.status,
    });
    if (!access.allowed) {
      throw new ForbiddenException(
        access.reason === 'TENANT_INACTIVE' ? 'Restaurante suspenso ou cancelado.' : 'Sem acesso a este restaurante.',
      );
    }

    return { tenantId: tenant.id, role: access.role, activeModules: activeModuleCodes(tenant.modules) };
  }
}
