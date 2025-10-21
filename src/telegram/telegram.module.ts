import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { ScraperModule } from '../scraper/scraper.module';
import { TelegramController } from './telegram.controller';

@Module({
  imports: [ScraperModule],
  providers: [TelegramService],
  controllers: [TelegramController],
  exports: [TelegramService],
})
export class TelegramModule {}
