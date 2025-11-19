import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { ScraperModule } from '../scraper/scraper.module';
import { TelegramController } from './telegram.controller';
import { ContactModule } from '../contact/contact.module';
import { GeminiModule } from '../gemini/gemini.module';
import { TransmisionesSceneService } from './scenes/transmisiones.scene';
import { CalendarioSceneService } from './scenes/calendario.scene';

@Module({
  imports: [ScraperModule, ContactModule, GeminiModule],
  controllers: [TelegramController],
  providers: [TelegramService, TransmisionesSceneService, CalendarioSceneService],
  exports: [TelegramService],
})
export class TelegramModule { }
