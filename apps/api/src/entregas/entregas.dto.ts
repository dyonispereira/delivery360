import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CourierDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsString() @MaxLength(20) phone: string;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) feeCents?: number;
}

export class UpdateCourierDto {
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
}
