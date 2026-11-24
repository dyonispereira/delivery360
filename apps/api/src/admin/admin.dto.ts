import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TENANT_ROLES, type TenantRole } from '@delivery360/shared';

const CNPJ_RE = /^\d{14}$/;

export class CreateTenantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  legalName?: string;

  @IsOptional()
  @Matches(CNPJ_RE, { message: 'CNPJ deve ter 14 números, sem pontuação.' })
  cnpj?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsUUID()
  planId?: string;
}

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  legalName?: string;

  @IsOptional()
  @Matches(CNPJ_RE, { message: 'CNPJ deve ter 14 números, sem pontuação.' })
  cnpj?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED', 'CANCELLED'])
  status?: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
}

export class SetPlanDto {
  @IsUUID()
  planId: string;
}

export class SetModuleDto {
  @IsBoolean()
  active: boolean;

  /** Fim opcional (teste grátis). null remove a data. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endsAt?: Date | null;
}

export class AddTenantUserDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEmail()
  email: string;

  /** Obrigatória só quando o e-mail ainda não tem conta. */
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'A senha precisa ter pelo menos 8 caracteres.' })
  password?: string;

  @IsIn(TENANT_ROLES)
  role: TenantRole;
}

export class CreateStaffDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8, { message: 'A senha precisa ter pelo menos 8 caracteres.' })
  password: string;

  @IsIn(['SUPER_ADMIN', 'ACCOUNT_MANAGER'])
  staffRole: 'SUPER_ADMIN' | 'ACCOUNT_MANAGER';
}

export class SetAccountManagersDto {
  @IsUUID('all', { each: true })
  userIds: string[];
}
