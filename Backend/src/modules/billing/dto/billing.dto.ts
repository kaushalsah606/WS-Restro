import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class PaymentInputDto {
  @ApiProperty({ enum: PaymentMethod }) @IsEnum(PaymentMethod) method: PaymentMethod;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0.01) amount: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) reference?: string;
}

export class AddPaymentDto {
  @ApiPropertyOptional({ enum: PaymentMethod }) @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) amount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) reference?: string;
  @ApiPropertyOptional({ type: [PaymentInputDto], description: 'Several payments in one call (mixed tender)' })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PaymentInputDto) payments?: PaymentInputDto[];
}

export class DiscountDto {
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) discount: number;
  @ApiPropertyOptional({ enum: ['amount', 'percent'] }) @IsOptional() @IsIn(['amount', 'percent']) type?: 'amount' | 'percent';
}

export class CheckoutDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) discount?: number;
  @ApiPropertyOptional({ enum: ['amount', 'percent'] }) @IsOptional() @IsIn(['amount', 'percent']) discountType?: 'amount' | 'percent';
  @ApiProperty({ type: [PaymentInputDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PaymentInputDto) payments: PaymentInputDto[];
}

class SplitEntryDto {
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0.01) amount: number;
  @ApiProperty({ enum: PaymentMethod }) @IsEnum(PaymentMethod) method: PaymentMethod;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) label?: string;
}

export class SplitBillDto {
  @ApiProperty({ type: [SplitEntryDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SplitEntryDto) splits: SplitEntryDto[];
}

class PartialItemDto {
  @IsUUID() itemId: string;
  @Type(() => Number) @IsInt() @Min(1) quantity: number;
}

export class PartialBillDto {
  @ApiProperty() @IsUUID() orderId: string;
  @ApiProperty({ type: [PartialItemDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PartialItemDto) items: PartialItemDto[];
  @ApiPropertyOptional({ enum: PaymentMethod }) @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
  @ApiPropertyOptional({ type: [PaymentInputDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PaymentInputDto) payments?: PaymentInputDto[];
}

export class MergeBillDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(2) @IsUUID('all', { each: true }) orderIds: string[];
  @ApiPropertyOptional({ enum: PaymentMethod }) @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;
  @ApiPropertyOptional({ type: [PaymentInputDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PaymentInputDto) payments?: PaymentInputDto[];
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) discount?: number;
}

export class RefundDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class BillQueryDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ enum: PaymentStatus }) @IsOptional() @IsEnum(PaymentStatus) status?: PaymentStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() orderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() endDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
}

export class PaymentQueryDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ enum: PaymentMethod }) @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  @ApiPropertyOptional() @IsOptional() @IsString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() endDate?: string;
}
