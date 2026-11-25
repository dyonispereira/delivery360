import type { ModuleCode, StaffRole, TenantRole } from '@delivery360/shared';

export interface AuthUser {
  id: string;
  staffRole: StaffRole | null;
}

export interface TenantContext {
  tenantId: string;
  role: TenantRole | null;
  activeModules: ModuleCode[];
}

export interface JwtPayload {
  sub: string;
  staffRole: StaffRole | null;
}

export const TENANT_HEADER = 'x-tenant-id';
