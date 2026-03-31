import { Module } from '@nestjs/common';
import { ScraperService } from './scraper.service';
import { ServitoroService } from './servitoro.service';
import { MundotoroEscalafonService } from './mundotoroEscalafon.service';
import { HttpModule } from '@nestjs/axios';
import { AmericaEventsService } from './americaEvents.service';
import { SevillaService } from './sevilla.service';
import { PuppeteerService } from './puppeteer.service';
import { VentasService } from './ventas.service';

@Module({
  imports: [HttpModule],
  providers: [
    ScraperService,
    ServitoroService,
    MundotoroEscalafonService,
    AmericaEventsService,
    SevillaService,
    PuppeteerService,
    VentasService,
  ],
  exports: [
    ScraperService,
    ServitoroService,
    MundotoroEscalafonService,
    AmericaEventsService,
    SevillaService,
    PuppeteerService,
    VentasService,
  ],
})
export class ScraperModule {}
