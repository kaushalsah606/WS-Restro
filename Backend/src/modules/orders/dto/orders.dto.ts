import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus, OrderType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class OrderItemInputDto {
  @ApiProperty() @IsUUID() menuItemId: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(99) quantity: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() variantId?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsUUID('all', { each: true }) addonIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) course?: string;
}

export class CreateOrderDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tableId?: string;
  @ApiPropertyOptional({ enum: OrderType }) @IsOptional() @IsEnum(OrderType) orderType?: OrderType;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) customerName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) customerPhone?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) discount?: number;
  @ApiProperty({ type: [OrderItemInputDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => OrderItemInputDto) items: OrderItemInputDto[];
}

export class AddItemsDto {
  @ApiProperty({ type: [OrderItemInputDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => OrderItemInputDto) items: OrderItemInputDto[];
}

export class UpdateOrderDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) discount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) customerName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) customerPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() waiterId?: string;
}

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus }) @IsEnum(OrderStatus) status: OrderStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}

export class UpdateOrderItemDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(99) quantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @ApiPropertyOptional({ enum: OrderStatus }) @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
}

export class OrderQueryDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ description: 'comma separated statuses' }) @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tableId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() waiterId?: string;
  @ApiPropertyOptional({ enum: OrderType }) @IsOptional() @IsEnum(OrderType) orderType?: OrderType;
  @ApiPropertyOptional() @IsOptional() @IsString() startDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() endDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() unpaid?: boolean;
}

export class SplitTableDto {
  @ApiProperty() @IsUUID() targetTableId: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @IsUUID('all', { each: true }) itemIds: string[];
  @ApiPropertyOptional({ description: 'itemId -> quantity to move (defaults to whole line)' })
  @IsOptional()
  quantities?: Record<string, number>;
}

export class KotQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ description: 'comma separated: printed,acknowledged,completed' }) @IsOptional() @IsString() status?: string;
}

export class KotStatusDto {
  @ApiProperty({ enum: ['printed', 'acknowledged', 'completed', 'cancelled'] })
  @IsEnum(['printed', 'acknowledged', 'completed', 'cancelled'])
  status: 'printed' | 'acknowledged' | 'completed' | 'cancelled';
}
