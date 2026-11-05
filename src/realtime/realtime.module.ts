import { Global, Module } from '@nestjs/common';
import { BusListener } from './bus.listener';
import { RealtimeGateway } from './realtime.gateway';

@Global()
@Module({ providers: [RealtimeGateway, BusListener], exports: [RealtimeGateway, BusListener] })
export class RealtimeModule {}
