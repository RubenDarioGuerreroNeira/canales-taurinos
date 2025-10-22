import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { ScraperModule } from '../scraper/scraper.module';
import { TelegramController } from './telegram.controller';
import { ContactModule } from '../contact/contact.module';

@Module({
  imports: [ScraperModule, ContactModule],
  providers: [TelegramService],
  controllers: [TelegramController],
  exports: [TelegramService],
})
export class TelegramModule {}
