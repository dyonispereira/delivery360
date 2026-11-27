import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { ModuleCode, StaffRole, TenantRole } from '@delivery360/shared';
import type { AuthUser, TenantContext } from './access.types';

export const IS_PUBLIC = 'access:public';
export const STAFF_ROLES_KEY = 'access:staffRoles';
export const TENANT_SCOPED = 'access:tenantScoped';
export const REQUIRED_MODULE = 'access:module';
export const TENANT_ROLES_KEY = 'access:tenantRoles';

/** Rota sem login (ex.: login, health, futuramente a loja pública). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Rota só da nossa equipe. Sem argumentos = qualquer papel de equipe. */
export const StaffOnly = (...roles: StaffRole[]) => SetMetadata(STAFF_ROLES_KEY, roles);

/** Rota dentro de um restaurante: exige o cabeçalho x-tenant-id e acesso a ele. */
export const TenantScoped = () => SetMetadata(TENANT_SCOPED, true);

/** Rota de um módulo: exige restaurante + chave do módulo ligada. */
export const RequireModule = (code: ModuleCode) => SetMetadata(REQUIRED_MODULE, code);

/** Rota que o garçom (papel WAITER) pode usar; o resto do sistema é fechado para ele. */
export const WAITER_ALLOWED = 'access:waiterAllowed';
export const WaiterAllowed = () => SetMetadata(WAITER_ALLOWED, true);

/** Papéis de restaurante permitidos (a equipe sempre passa). */
export const TenantRoles = (...roles: TenantRole[]) => SetMetadata(TENANT_ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);

export const CurrentTenant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): TenantContext => ctx.switchToHttp().getRequest().tenant,
);
