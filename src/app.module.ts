import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TelegramModule } from './telegram/telegram.module';
import { ScraperModule } from './scraper/scraper.module';
import { KeepAliveService } from './keep-alive.service';
import { AppController } from './app.controller';
import { ContactModule } from './contact/contact.module';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScraperModule,
    TelegramModule,
    ContactModule,
  ],
  // El AppController es necesario para que el endpoint /ping esté disponible
  controllers: [AppController],
  providers: [AppService, KeepAliveService],
})
export class AppModule {}
