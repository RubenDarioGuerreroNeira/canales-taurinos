import { Module } from '@nestjs/common';
import { ScraperService } from './scraper.service';
import { ServitoroService } from './servitoro.service';
import { MundotoroEscalafonService } from './mundotoroEscalafon.service';
import { HttpModule } from '@nestjs/axios';
import { AmericaEventsService } from './americaEvents.service';

@Module({
  imports: [HttpModule],
  providers: [
    ScraperService,
    ServitoroService,
    MundotoroEscalafonService,
    AmericaEventsService,
  ],
  exports: [
    ScraperService,
    ServitoroService,
    MundotoroEscalafonService,
    AmericaEventsService,
  ],
})
export class ScraperModule {}
