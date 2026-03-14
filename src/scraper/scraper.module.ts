import { Module } from '@nestjs/common';
import { ScraperService } from './scraper.service';
import { ServitoroService } from './servitoro.service';
import { MundotoroEscalafonService } from './mundotoroEscalafon.service';
import { HttpModule } from '@nestjs/axios';
import { AmericaEventsService } from './americaEvents.service';
import { SevillaService } from './sevilla.service';
import { PuppeteerService } from './puppeteer.service';

@Module({
  imports: [HttpModule],
  providers: [
    ScraperService,
    ServitoroService,
    MundotoroEscalafonService,
    AmericaEventsService,
    SevillaService,
    PuppeteerService,
  ],
  exports: [
    ScraperService,
    ServitoroService,
    MundotoroEscalafonService,
    AmericaEventsService,
    SevillaService,
    PuppeteerService,
  ],
})
export class ScraperModule {}
