import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TelegramModule } from './telegram/telegram.module';
import { ScraperModule } from './scraper/scraper.module';
import { KeepAliveService } from './keep-alive.service';
import { AppController } from './app.controller';
import { ContactModule } from './contact/contact.module';
import { AppService } from './app.service';
import { GeminiModule } from './gemini/gemini.module';
import { WeatherModule } from './weather/weather.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Importación condicional: Solo carga el ScheduleModule si no estamos en modo script.
    ...(process.env.IS_SCRIPT_MODE !== 'true'
      ? [ScheduleModule.forRoot()]
      : []),
    ScraperModule,
    TelegramModule,
    ContactModule,
    GeminiModule,
    WeatherModule,
  ],
  // El AppController es necesario para que el endpoint /ping esté disponible
  controllers: [AppController],
  providers: [AppService, KeepAliveService],
})
export class AppModule {}
