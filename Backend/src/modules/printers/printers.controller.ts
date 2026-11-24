import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ALL_STAFF, AuthUser, BILLING_STAFF, CurrentUser, MANAGERS, Roles } from '../../common/decorators';
import { PrintersService } from './printers.service';

class PrinterDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiProperty() @IsString() @MaxLength(100) name: string;
  @ApiPropertyOptional({ enum: ['thermal', 'receipt', 'kitchen'] }) @IsOptional() @IsIn(['thermal', 'receipt', 'kitchen']) type?: string;
  @ApiPropertyOptional({ enum: ['usb', 'network'] }) @IsOptional() @IsIn(['usb', 'network']) connectionType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) ipAddress?: string | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(65535) port?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) categories?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsIn(['kot', 'bill', 'report'], { each: true }) printFor?: string[];
}

class UpdatePrinterDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsIn(['thermal', 'receipt', 'kitchen']) type?: string;
  @IsOptional() @IsIn(['usb', 'network']) connectionType?: string;
  @IsOptional() @IsString() ipAddress?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) categories?: string[];
  @IsOptional() @IsArray() @IsIn(['kot', 'bill', 'report'], { each: true }) printFor?: string[];
}

class PrintBillDto {
  @ApiProperty() @IsUUID() billId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() printerId?: string;
}

class ReprintKotDto {
  @ApiProperty() @IsUUID() kotId: string;
}

class AckDto {
  @IsBoolean() ok: boolean;
  @IsOptional() @IsString() error?: string;
}

class TemplateDto {
  @IsOptional() @IsUUID() branchId?: string;
  @IsIn(['kot', 'bill']) type: 'kot' | 'bill';
  @IsOptional() @IsString() @MaxLength(60) name?: string;
  @IsObject() config: Record<string, any>;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@ApiTags('printers')
@ApiBearerAuth()
@Controller('printers')
export class PrintersController {
  constructor(private readonly svc: PrintersService) {}

  @Roles(...ALL_STAFF)
  @Get()
  list(@CurrentUser() user: AuthUser, @Query('branchId') branchId?: string) {
    return this.svc.list(user, branchId);
  }

  @Roles(...ALL_STAFF)
  @Get('jobs')
  jobs(@CurrentUser() user: AuthUser, @Query() q: { branchId?: string; status?: string; limit?: number }) {
    return this.svc.listJobs(user, q);
  }

  @Roles(...ALL_STAFF)
  @Post('jobs/:id/retry')
  retry(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.retryJob(user, id);
  }

  @Roles(...ALL_STAFF)
  @Post('jobs/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancelJob(user, id);
  }

  /** Terminal reports the outcome of a locally-printed (USB) job. */
  @Roles(...ALL_STAFF)
  @Patch('jobs/:id/ack')
  ack(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AckDto) {
    return this.svc.ackJob(user, id, dto.ok, dto.error);
  }

  @Roles(...BILLING_STAFF)
  @Post('print/bill')
  printBill(@Body() dto: PrintBillDto) {
    return this.svc.enqueueBill(dto.billId, dto.printerId);
  }

  @Roles(...ALL_STAFF)
  @Post('print/kot')
  printKot(@Body() dto: ReprintKotDto) {
    return this.svc.enqueueKot(dto.kotId, true);
  }

  @Roles(...MANAGERS)
  @Get('templates')
  templates(@CurrentUser() user: AuthUser, @Query('branchId') branchId?: string) {
    return this.svc.listTemplates(user, branchId);
  }

  @Roles(...MANAGERS)
  @Put('templates')
  upsertTemplate(@CurrentUser() user: AuthUser, @Body() dto: TemplateDto) {
    return this.svc.upsertTemplate(user, dto);
  }

  @Roles(...MANAGERS)
  @Delete('templates/:id')
  deleteTemplate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteTemplate(user, id);
  }

  @Roles(...MANAGERS)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: PrinterDto) {
    return this.svc.create(user, dto);
  }

  @Roles(...MANAGERS)
  @Put(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePrinterDto) {
    return this.svc.update(user, id, dto);
  }

  @Roles(...MANAGERS)
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(user, id);
  }

  @Roles(...MANAGERS)
  @Post(':id/test')
  test(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.enqueueTest(user, id);
  }

  @Roles(...BILLING_STAFF)
  @Post(':id/open-drawer')
  drawer(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.enqueueDrawer(user, id);
  }
}
