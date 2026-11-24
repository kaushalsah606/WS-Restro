import { Module } from '@nestjs/common';
import { PrintProcessor } from './print.processor';
import { PrintersController } from './printers.controller';
import { PrintersService } from './printers.service';

@Module({
  controllers: [PrintersController],
  providers: [PrintersService, PrintProcessor],
  exports: [PrintersService],
})
export class PrintersModule {}
