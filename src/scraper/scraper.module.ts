import { Module } from '@nestjs/common';
import { ScraperService } from './scraper.service';
import { ServitoroService } from './servitoro.service';

@Module({
  providers: [ScraperService, ServitoroService],
  exports: [ScraperService, ServitoroService],
})
export class ScraperModule {}
