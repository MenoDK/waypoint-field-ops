import { Module } from '@nestjs/common';
import { TripsModule } from '../modules/trips/trips.module';
import { LabController } from './lab.controller';
import { LabGate } from './lab.gate';

@Module({ imports: [TripsModule], controllers: [LabController], providers: [LabGate] })
export class LabModule {}
