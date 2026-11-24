'use client';

import { createContext, useContext } from 'react';
import type { ModuleCode, TenantRole } from '@delivery360/shared';

export interface CurrentTenant {
  id: string;
  name: string;
  status: string;
  role: TenantRole | null;
  activeModules: ModuleCode[];
}

export const TenantCtx = createContext<CurrentTenant | null>(null);

export function useCurrentTenant() {
  const t = useContext(TenantCtx);
  if (!t) throw new Error('useCurrentTenant fora do sistema do restaurante');
  return t;
}
