import { Injectable } from '@nestjs/common';
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
  constructor(private readonly weatherService: WeatherService) { }

  create(): Scenes.BaseScene<MyContext> {
    const scene = new Scenes.BaseScene<MyContext>('americaScene');

    scene.enter(async (ctx) => {
      let userName = 'aficionado';
      try {
        if (ctx.from?.first_name) {
          if (typeof ctx.from.first_name === 'object') {
            userName = 'aficionado';
          } else {
            userName = String(ctx.from.first_name);
          }
        }
      } catch (e) {
        userName = 'aficionado';
      }

      try {
        const dataPath = path.join(process.cwd(), 'data', 'america-events.json');
        const fileContent = await fs.readFile(dataPath, 'utf-8');
        const rawLocations: { [location: string]: AmericaEvent[] } = JSON.parse(fileContent);

        if (!rawLocations || Object.keys(rawLocations).length === 0) {
          await ctx.reply(`Lo siento ${userName}, no hay carteles de América disponibles en este momento.`);
          return ctx.scene.leave();
        }

        const sceneState = ctx.scene.state as MySceneSession; // Explicitly cast
        const searchTerm = sceneState.americaSearchTerm;
        console.log(`[AmericaScene] Received searchTerm: ${searchTerm}`);
        console.log(`[AmericaScene] rawLocations keys: ${Object.keys(rawLocations).join(', ')}`);

        // Si el término de búsqueda es general, no hacemos búsqueda directa
        const isGeneralSearch = searchTerm && ['colombia', 'america', 'américa'].includes(searchTerm);
        console.log(`[AmericaScene] isGeneralSearch: ${isGeneralSearch}`);

        if (searchTerm && !isGeneralSearch) {
          // Attempt to find a direct match based on the search term
          const matchingLocationKey = Object.keys(rawLocations).find(key =>
            key.split(',')[0].trim().toLowerCase() === searchTerm.toLowerCase()
          );
          console.log(`[AmericaScene] Found matchingLocationKey: ${matchingLocationKey}`);

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

      } catch (error) {
        console.error('Error reading or parsing america-events.json:', error);
        await ctx.reply(`Lo siento ${userName}, ha ocurrido un error al cargar los carteles.`);
        return ctx.scene.leave();
      }
    });

    scene.action(/loc_(.+)/, async (ctx) => {
      const locationKey = ctx.match[1];
      await ctx.answerCbQuery();

      try {
        const dataPath = path.join(process.cwd(), 'data', 'america-events.json');
        const fileContent = await fs.readFile(dataPath, 'utf-8');
        const rawLocations: { [location: string]: AmericaEvent[] } = JSON.parse(fileContent);

        await this.displayEventsForLocation(ctx, locationKey, rawLocations);

        // Botón para volver
        await ctx.reply(
          `¿Deseas consultar otra ciudad?`,
          Markup.inlineKeyboard([
            Markup.button.callback('🔙 Volver al listado', 'back_to_list'),
            Markup.button.callback('❌ Salir', 'exit_america')
          ])
        );

      } catch (error) {
        console.error('Error fetching details:', error);
        await ctx.reply(`Ocurrió un error al obtener los detalles.`);
      }
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
        const today = new Date();
        // Reset time to compare dates properly
        today.setHours(0, 0, 0, 0);
        const eventDateOnly = new Date(eventDate);
        eventDateOnly.setHours(0, 0, 0, 0);

        const diffTime = eventDateOnly.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        // Open-Meteo free forecast is usually up to 7 days, sometimes up to 14 or 16 depending on settings.
        // But to be safe/consistent with user request logic:
        if (diffDays > 7) {
          weatherInfo = `\n📅 _El pronóstico del clima estará disponible 7 días antes del evento_`;
        } else if (diffDays < 0) {
          // Event passed
          weatherInfo = '';
        } else {
          try {
            const weather = await this.weatherService.getWeather(city, eventDate);
            if (weather.success && weather.data) {
              const temp = Math.round(weather.data.temperature);
              const desc = weather.data.description;
              weatherInfo = `\n🌤 _Pronóstico:_ ${temp}°C \- ${desc}`;
            }
          } catch (e) {
            console.error(`Error getting weather for ${city} on ${eventDate}:`, e);
          }
        }
      }

      const details = `🐂 Toros de ${escapeMarkdownV2(event.ganaderia)}
🤺 Para ${escapeMarkdownV2(toreros)}${escapeMarkdownV2(weatherInfo)}`;

      await ctx.reply(`${eventTitle}\n${details}`, { parse_mode: 'MarkdownV2' });
    }
  }

}
