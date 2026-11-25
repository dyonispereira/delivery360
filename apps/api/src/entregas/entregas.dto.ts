import { IsEnum, IsLatitude, IsLongitude, IsNumber, ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CourierDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsString() @MaxLength(20) phone: string;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) feeCents?: number;
  @IsOptional() @IsString() @MaxLength(10) plate?: string;
}

export class UpdateCourierDto {
  @IsOptional() @IsString() @MaxLength(10) plate?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) feeCents?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CreateBatchDto {
  @IsUUID() courierId: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('all', { each: true }) orderIds: string[];
}

export class DeliverDto {
  @IsString() @Matches(/^\D*(\d\D*){4}$/, { message: 'Digite os 4 números.' }) code: string;
  @IsString() @MinLength(2, { message: 'Informe o nome de quem recebeu.' }) @MaxLength(80) receiverName: string;
}

export const FAIL_REASONS = ['ADDRESS_NOT_FOUND', 'CUSTOMER_ABSENT', 'CUSTOMER_REFUSED', 'OTHER'] as const;
export type FailReason = (typeof FAIL_REASONS)[number];

export class FailDeliveryDto {
  @IsEnum(FAIL_REASONS, { message: 'Escolha o motivo.' }) reason: FailReason;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class FixAttemptDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) receiverName?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class LocationDto {
  @IsLatitude() lat: number;
  @IsLongitude() lng: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100_000) accuracy?: number;
}
