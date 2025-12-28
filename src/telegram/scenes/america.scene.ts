import { Injectable, Logger } from '@nestjs/common';
import { Scenes, Markup } from 'telegraf';
import { MyContext, MySceneSession } from '../telegram.interfaces'; // Import MySceneSession
import * as fs from 'fs/promises';
import * as path from 'path';
import { escapeMarkdownV2, parseSpanishDate } from '../../utils/telegram-format'; // Import the centralized utility
import { WeatherService } from '../../weather/weather.service';

interface AmericaEvent {
  fecha: string;
  ganaderia: string;
  toreros: string[];
  descripcion?: string;
}

@Injectable()
export class AmericaSceneService {
  private readonly logger = new Logger(AmericaSceneService.name);
  private eventsCache: { [location: string]: AmericaEvent[] } | null = null;
  private lastCacheTime = 0;
  private readonly CACHE_TTL = 1000 * 60 * 10; // 10 minutos de caché

  constructor(private readonly weatherService: WeatherService) { }

  private async getEventsData(): Promise<{ [location: string]: AmericaEvent[] }> {
    if (this.eventsCache && Date.now() - this.lastCacheTime < this.CACHE_TTL) {
      return this.eventsCache;
    }

    try {
      const dataPath = path.join(process.cwd(), 'data', 'america-events.json');
      const fileContent = await fs.readFile(dataPath, 'utf-8');
      const data = JSON.parse(fileContent);
      this.eventsCache = data;
      this.lastCacheTime = Date.now();
      return data;
    } catch (error) {
      this.logger.error(`Error reading or parsing america-events.json: ${error.message}`, error.stack);
      return {};
    }
  }

  create(): Scenes.BaseScene<MyContext> {
    const scene = new Scenes.BaseScene<MyContext>('americaScene');

    scene.enter(async (ctx) => {
      const userName = ctx.from?.first_name || 'aficionado';

      const rawLocations = await this.getEventsData();

      if (!rawLocations || Object.keys(rawLocations).length === 0) {
        await ctx.reply(`Lo siento ${userName}, no hay carteles de América disponibles en este momento.`);
        return ctx.scene.leave();
      }

      const sceneState = ctx.scene.state as MySceneSession; // Explicitly cast
      const searchTerm = sceneState.americaSearchTerm;
      this.logger.log(`Received searchTerm: ${searchTerm}`);

      // Si el término de búsqueda es general, no hacemos búsqueda directa
      const isGeneralSearch = searchTerm && ['colombia', 'america', 'américa', 'corridas en colombia', 'festejos en colombia', 'corridas en manizales', 'corridas en cali'].includes(searchTerm.toLowerCase());

      if (searchTerm && !isGeneralSearch) {
        // Attempt to find a direct match based on the search term
        const matchingLocationKey = Object.keys(rawLocations).find(key =>
          key.split(',')[0].trim().toLowerCase() === searchTerm.toLowerCase()
        );

        if (matchingLocationKey) {
          await this.displayEventsForLocation(ctx, matchingLocationKey, rawLocations);
          // After displaying events, offer to go back to list or exit
          await ctx.reply(
            `¿Deseas consultar otra ciudad?`,
            Markup.inlineKeyboard([
              Markup.button.callback('🔙 Volver al listado', 'back_to_list'),
              Markup.button.callback('❌ Salir', 'exit_america')
            ])
          );
          return; // Exit scene.enter, since events are displayed
        } else {
          await ctx.reply('Lo siento no tengo esa respuesta por ahora');
          return ctx.scene.leave();
        }
      }

      // --- Original logic if no search term or direct match not found ---
      const countryMap: { [country: string]: string[] } = {};

      Object.keys(rawLocations).forEach(key => {
        const parts = key.split(',').map(p => p.trim());
        if (parts.length >= 2) {
          const city = parts[0];
          const country = parts[1];
          if (!countryMap[country]) {
            countryMap[country] = [];
          }
          countryMap[country].push(city);
        } else {
          const country = 'Otros';
          if (!countryMap[country]) countryMap[country] = [];
          countryMap[country].push(key);
        }
      });

      let message = `${escapeMarkdownV2('¡Hola')} ${escapeMarkdownV2(userName)}${escapeMarkdownV2('!')} 👋\n\n`;

      const countries = Object.keys(countryMap);
      if (countries.length > 0) {
        countries.forEach(country => {
          const cities = countryMap[country].join(' y ');
          message += `En ${escapeMarkdownV2('América')} en el país de *${escapeMarkdownV2(country)}* existen eventos programados para las Ciudades de: *${escapeMarkdownV2(cities)}*\n`;
        });
        message += `\n${escapeMarkdownV2('¿Qué ciudad prefieres?')}`;
      } else {
        message += `He encontrado eventos pero no pude identificar los países\. ${escapeMarkdownV2('¿Cuál prefieres ver?')}`;
      }

      const buttons = Object.keys(rawLocations).map(fullLocation => {
        const label = fullLocation.split(',')[0].trim();
        return Markup.button.callback(label, `loc_${fullLocation}`);
      });

      buttons.push(Markup.button.callback('❌ Salir', 'exit_america'));

      await ctx.reply(message, {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard(buttons, { columns: 2 }),
      });
    });

    scene.action(/loc_(.+)/, async (ctx) => {
      const locationKey = ctx.match[1];
      await ctx.answerCbQuery();

      const rawLocations = await this.getEventsData();

      await this.displayEventsForLocation(ctx, locationKey, rawLocations);

      // Botón para volver
      await ctx.reply(
        `¿Deseas consultar otra ciudad?`,
        Markup.inlineKeyboard([
          Markup.button.callback('🔙 Volver al listado', 'back_to_list'),
          Markup.button.callback('❌ Salir', 'exit_america')
        ])
      );
    });

    scene.action('back_to_list', async (ctx) => {
      await ctx.answerCbQuery();
      (ctx.scene.state as MySceneSession).americaSearchTerm = undefined; // Clear search term on back
      return ctx.scene.reenter();
    });

    scene.action('exit_america', async (ctx) => {
      await ctx.answerCbQuery();
      const userName = ctx.from?.first_name || 'aficionado';
      await ctx.reply(`¡De acuerdo ${userName}! ¿En qué más puedo ayudarte?`);
      return ctx.scene.leave();
    });

    scene.on('text', (ctx) => {
      // If something is typed that we don't understand in this context, we re-show the list
      ctx.scene.reenter();
    });

    return scene;
  }

  private async displayEventsForLocation(
    ctx: MyContext,
    locationKey: string,
    rawLocations: { [location: string]: AmericaEvent[] }
  ): Promise<void> {
    const events = rawLocations[locationKey];
    const userName = ctx.from?.first_name || 'aficionado';
    const city = locationKey.split(',')[0].trim();

    if (!events || events.length === 0) {
      await ctx.reply(`Lo siento ${userName}, no encuentro información para ${escapeMarkdownV2(locationKey)}.`);
      return;
    }

    const header = `*📍 Carteles en ${escapeMarkdownV2(locationKey)}*`;
    await ctx.reply(header, { parse_mode: 'MarkdownV2' });

    for (const event of events) {
      const toreros = event.toreros.join(', ');
      let eventTitle = `*${escapeMarkdownV2(event.fecha)}*`;
      if (event.descripcion) {
        eventTitle += ` \- _${escapeMarkdownV2(event.descripcion)}_`;
      }

      let weatherInfo = '';
      const eventDate = parseSpanishDate(event.fecha);
      if (eventDate) {
        weatherInfo = await this.weatherService.getWeatherForecastMessage(city, eventDate);
      }


      const details = `🐂 Toros de ${escapeMarkdownV2(event.ganaderia)}
🤺 Para ${escapeMarkdownV2(toreros)}${escapeMarkdownV2(weatherInfo)}`;

      await ctx.reply(`${eventTitle}\n${details}`, { parse_mode: 'MarkdownV2' });
    }

    // Mensaje de seguimiento final
    await ctx.reply(
      escapeMarkdownV2(`¿Qué más te gustaría saber sobre los festejos en ${locationKey}?`),
      Markup.inlineKeyboard([
        [Markup.button.callback('📅 Volver a la Lista', 'back_to_list')],
        [Markup.button.callback('🏠 Salir', 'exit_america')],
      ])
    );
  }

}
