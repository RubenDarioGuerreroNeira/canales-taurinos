import { Module } from '@nestjs/common';
import { ScraperService } from './scraper.service';
import { ServitoroService } from './servitoro.service';
import { MundotoroEscalafonService } from './mundotoroEscalafon.service';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  providers: [ScraperService, ServitoroService, MundotoroEscalafonService],
  exports: [ScraperService, ServitoroService, MundotoroEscalafonService],
})
export class ScraperModule {}
