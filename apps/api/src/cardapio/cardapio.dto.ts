import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const PAYMENT_METHODS = ['PIX', 'CREDIT_CARD', 'CASH_ON_DELIVERY', 'CARD_ON_DELIVERY'] as const;
const MAX_CENTS = 10_000_000; // R$ 100 mil

export class UpdateStoreDto {
  @IsOptional() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'Endereço da loja: só letras minúsculas, números e hífen.' }) @MinLength(3) @MaxLength(60)
  slug?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) displayName?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsUrl({ require_protocol: true }) logoUrl?: string;
  @IsOptional() @Matches(/^\d{10,13}$/, { message: 'WhatsApp: só números, com DDD.' }) whatsapp?: string;
  @IsOptional() @IsBoolean() isOpen?: boolean;
  @IsOptional() @IsBoolean() acceptsDelivery?: boolean;
  @IsOptional() @IsBoolean() acceptsPickup?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) minOrderCents?: number;
  @IsOptional() @IsArray() @IsIn(PAYMENT_METHODS, { each: true }) paymentMethods?: (typeof PAYMENT_METHODS)[number][];
  @IsOptional() @IsInt() @Min(5) @Max(240) estimatedMinutes?: number;
}

export class ZoneDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsInt() @Min(0) @Max(MAX_CENTS) feeCents: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdateZoneDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) feeCents?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CategoryDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsOptional() @IsInt() position?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdateCategoryDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsInt() position?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class ProductDto {
  @IsUUID() categoryId: string;
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsInt() @Min(0) @Max(MAX_CENTS) priceCents: number;
  @IsOptional() @IsUrl({ require_protocol: true }) imageUrl?: string;
  @IsOptional() @IsInt() position?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() available?: boolean;
}
export class UpdateProductDto {
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) priceCents?: number;
  @IsOptional() @IsUrl({ require_protocol: true }) imageUrl?: string;
  @IsOptional() @IsInt() position?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() available?: boolean;
}

export class OptionGroupDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsInt() @Min(0) @Max(50) minSelect: number;
  @IsInt() @Min(1) @Max(50) maxSelect: number;
  @IsOptional() @IsInt() position?: number;
}
export class UpdateOptionGroupDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(50) minSelect?: number;
  @IsOptional() @IsInt() @Min(1) @Max(50) maxSelect?: number;
  @IsOptional() @IsInt() position?: number;
}

export class OptionDto {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsInt() @Min(0) @Max(MAX_CENTS) priceCents: number;
  @IsOptional() @IsBoolean() available?: boolean;
  @IsOptional() @IsInt() position?: number;
}
export class UpdateOptionDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) priceCents?: number;
  @IsOptional() @IsBoolean() available?: boolean;
  @IsOptional() @IsInt() position?: number;
}

// ---------- Pedido público (loja online) ----------

export class OrderItemInputDto {
  @IsUUID() productId: string;
  @IsInt() @Min(1) @Max(50) quantity: number;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) optionIds?: string[];
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class CustomerInputDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsString() @MaxLength(20) phone: string;
}

export class AddressInputDto {
  @IsUUID() zoneId: string;
  @IsString() @MinLength(2) @MaxLength(120) street: string;
  @IsString() @MinLength(1) @MaxLength(20) number: string;
  @IsOptional() @IsString() @MaxLength(80) complement?: string;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
}

export class CreateOrderDto {
  @IsIn(['DELIVERY', 'PICKUP']) type: 'DELIVERY' | 'PICKUP';
  @ValidateNested() @Type(() => CustomerInputDto) customer: CustomerInputDto;
  @IsOptional() @ValidateNested() @Type(() => AddressInputDto) address?: AddressInputDto;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => OrderItemInputDto) items: OrderItemInputDto[];
  @IsIn(PAYMENT_METHODS) paymentMethod: (typeof PAYMENT_METHODS)[number];
  @IsOptional() @IsInt() @Min(0) @Max(MAX_CENTS) changeForCents?: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsString() @MaxLength(100) utmSource?: string;
  @IsOptional() @IsString() @MaxLength(100) utmCampaign?: string;
}
