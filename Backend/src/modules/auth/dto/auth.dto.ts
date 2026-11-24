import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppRole } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

const trimLower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class LoginDto {
  @ApiProperty() @Transform(trimLower) @IsEmail() email: string;
  @ApiProperty() @IsString() @MinLength(1) password: string;
}

export class RegisterDto {
  @ApiProperty() @Transform(trimLower) @IsEmail() email: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) @MaxLength(128) password: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) fullName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @ApiPropertyOptional({ enum: AppRole }) @IsOptional() @IsEnum(AppRole) role?: AppRole;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}

export class RefreshTokenDto {
  @ApiProperty() @IsString() @MinLength(10) refreshToken: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) fullName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) avatarUrl?: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() currentPassword: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) @MaxLength(128) newPassword: string;
}

export class CreateUserDto {
  @ApiProperty() @Transform(trimLower) @IsEmail() email: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) @MaxLength(128) password: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) fullName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @ApiProperty({ enum: AppRole }) @IsEnum(AppRole) role: AppRole;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) fullName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(8) @MaxLength(128) password?: string;
}

export class AssignRoleDto {
  @ApiProperty({ enum: AppRole }) @IsEnum(AppRole) role: AppRole;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}

export class ListUsersDto extends PaginationDto {
  @ApiPropertyOptional({ enum: AppRole }) @IsOptional() @IsEnum(AppRole) role?: AppRole;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}
