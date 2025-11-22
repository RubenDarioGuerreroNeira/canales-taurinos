import { Injectable } from '@nestjs/common';
import { Scenes, Markup } from 'telegraf';
import { MyContext } from '../telegram.interfaces';
import * as fs from 'fs/promises';
import * as path from 'path';

interface AmericaEvent {
  fecha: string;
  ganaderia: string;
  toreros: string[];
  descripcion?: string;
}

@Injectable()
export class AmericaSceneService {
  create(): Scenes.BaseScene<MyContext> {
    const scene = new Scenes.BaseScene<MyContext>('americaScene');

    scene.enter(async (ctx) => {
      // Asegurar que userName sea siempre un string válido
      let userName = 'aficionado';
      try {
        if (ctx.from?.first_name) {
          // Si first_name es un objeto, intentar convertirlo a JSON y luego a string
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

        // Agrupar por País -> Ciudades
        const countryMap: { [country: string]: string[] } = {};

        Object.keys(rawLocations).forEach(key => {
          // Asumimos formato "Ciudad, País"
          const parts = key.split(',').map(p => p.trim());
          if (parts.length >= 2) {
            const city = parts[0];
            const country = parts[1];
            if (!countryMap[country]) {
              countryMap[country] = [];
            }
            countryMap[country].push(city);
          } else {
            // Fallback si no hay coma
            const country = 'Otros';
            if (!countryMap[country]) countryMap[country] = [];
            countryMap[country].push(key);
          }
        });

        // Construir mensaje conversacional - Escapar todo correctamente
        let message = `${this.escapeMarkdownV2('¡Hola')} ${this.escapeMarkdownV2(userName)}${this.escapeMarkdownV2('!')} 👋\\n\\n`;

        const countries = Object.keys(countryMap);
        if (countries.length > 0) {
          countries.forEach(country => {
            const cities = countryMap[country].join(' y ');
            message += `En ${this.escapeMarkdownV2('América')} en el país de *${this.escapeMarkdownV2(country)}* existen eventos programados para las Ciudades de: *${this.escapeMarkdownV2(cities)}*\\n`;
          });
          message += `\\n${this.escapeMarkdownV2('¿Qué ciudad prefieres?')}`;
        } else {
          message += `He encontrado eventos pero no pude identificar los países\\. ${this.escapeMarkdownV2('¿Cuál prefieres ver?')}`;
        }

        // Crear botones para cada ubicación original (que es lo que usaremos para filtrar)
        const buttons = Object.keys(rawLocations).map(fullLocation => {
          // Extraer solo la ciudad para el botón si es posible
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

    // Acción para mostrar eventos de una ciudad específica
    scene.action(/loc_(.+)/, async (ctx) => {
      const locationKey = ctx.match[1];
      await ctx.answerCbQuery();

      try {
        const dataPath = path.join(process.cwd(), 'data', 'america-events.json');
        const fileContent = await fs.readFile(dataPath, 'utf-8');
        const rawLocations: { [location: string]: AmericaEvent[] } = JSON.parse(fileContent);
        const events = rawLocations[locationKey];

        if (!events) {
          await ctx.reply(`Lo siento, ya no encuentro información para ${locationKey}.`);
          return ctx.scene.reenter();
        }

        const header = `*📍 Carteles en ${this.escapeMarkdownV2(locationKey)}*`;

        for (const event of events) {
          const toreros = event.toreros.join(', ');
          let eventTitle = `*${this.escapeMarkdownV2(event.fecha)}*`;
          if (event.descripcion) {
            eventTitle += ` \\- _${this.escapeMarkdownV2(event.descripcion)}_`;
          }
          const details = `🐂 Toros de ${this.escapeMarkdownV2(event.ganaderia)}\n🤺 Para ${this.escapeMarkdownV2(toreros)}`;

          await ctx.reply(`${eventTitle}\n${details}`, { parse_mode: 'MarkdownV2' });
        }

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
      return ctx.scene.reenter();
    });

    scene.action('exit_america', async (ctx) => {
      await ctx.answerCbQuery();
      const userName = ctx.from?.first_name || 'aficionado';
      await ctx.reply(`¡De acuerdo ${userName}! ¿En qué más puedo ayudarte?`);
      return ctx.scene.leave();
    });

    scene.on('text', (ctx) => {
      // Si escribe algo que no entendemos en este contexto, salimos o re-preguntamos.
      // Para ser amables, salimos.
      ctx.scene.leave();
    });

    return scene;
  }

  private escapeMarkdownV2(text: string): string {
    if (!text) return '';
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }
}
