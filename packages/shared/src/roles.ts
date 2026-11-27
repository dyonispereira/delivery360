/** Papéis da nossa equipe (painel admin). Um usuário de restaurante não tem papel de equipe. */
export const STAFF_ROLES = ['SUPER_ADMIN', 'ACCOUNT_MANAGER'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Papéis dentro de um restaurante. */
export const TENANT_ROLES = ['OWNER', 'MANAGER', 'STAFF', 'WAITER'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export const TENANT_ROLE_LABELS: Record<TenantRole, string> = {
  OWNER: 'Dono',
  MANAGER: 'Gerente',
  STAFF: 'Funcionário',
  WAITER: 'Garçom',
};

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  SUPER_ADMIN: 'Super admin',
  ACCOUNT_MANAGER: 'Gestor de conta',
};
