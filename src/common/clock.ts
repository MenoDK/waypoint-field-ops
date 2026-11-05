import { Global, Injectable, Module } from '@nestjs/common';

/**
 * Every decision that depends on "now" (is this capture from the future, has this phone gone quiet, has the link expired)
 * asks this clock instead of calling `new Date()`. In production it is the system clock; tests replace it with one they can
 * move, which is what makes "15 minutes of silence" a test that runs in a millisecond.
 */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}

@Global()
@Module({ providers: [Clock], exports: [Clock] })
export class ClockModule {}
