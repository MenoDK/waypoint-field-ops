import { Module } from '@nestjs/common';
import { SheetService } from './sheet.service';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';

@Module({
  controllers: [TripsController],
  providers: [TripsService, SheetService],
  exports: [TripsService],
})
export class TripsModule {}
