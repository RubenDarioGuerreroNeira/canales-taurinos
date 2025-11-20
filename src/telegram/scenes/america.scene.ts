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
      const userName = ctx.from?.first_name || 'aficionado';
      try {
        const dataPath = path.join(process.cwd(), 'data', 'america-events.json');
        const fileContent = await fs.readFile(dataPath, 'utf-8');
        const locations: { [location: string]: AmericaEvent[] } = JSON.parse(fileContent);

        if (!locations || Object.keys(locations).length === 0) {
          await ctx.reply(`Lo siento ${userName}, no hay carteles de América disponibles en este momento.`);
          return ctx.scene.leave();
        }

        const header = `*Carteles de Festejos en América* 🌎\n\n`;
        const locationBlocks = Object.entries(locations).map(([location, events]) => {
          const locationHeader = `*📍 ${this.escapeMarkdownV2(location)}*`;

          const eventMessages = events.map(event => {
            const toreros = event.toreros.join(', ');
            let eventTitle = `*${this.escapeMarkdownV2(event.fecha)}*`;
            if (event.descripcion) {
              eventTitle += ` \\- _${this.escapeMarkdownV2(event.descripcion)}_`;
            }
            const details = `🐂 Toros de ${this.escapeMarkdownV2(event.ganaderia)}\n🤺 Para ${this.escapeMarkdownV2(toreros)}`;
            return `${eventTitle}\n${details}`;
          }).join(`\n\n${this.escapeMarkdownV2('--------------------')}\n\n`);

          return `${locationHeader}\n${eventMessages}`;
        });

        const finalMessage = header + locationBlocks.join(`\n\n${this.escapeMarkdownV2('====================')}\n\n`);

        await ctx.reply(finalMessage, {
          parse_mode: 'MarkdownV2',
          ...Markup.inlineKeyboard([
            Markup.button.callback('❌ Salir', 'exit_america'),
          ]),
        });

      } catch (error) {
        console.error('Error reading or parsing america-events.json:', error);
        await ctx.reply(`Lo siento ${userName}, ha ocurrido un error al cargar los carteles.`);
        return ctx.scene.leave();
      }
    });

    scene.action('exit_america', async (ctx) => {
      await ctx.answerCbQuery();
      const userName = ctx.from?.first_name || 'aficionado';
      await ctx.reply(`¡De acuerdo ${userName}! ¿En qué más puedo ayudarte?`);
      return ctx.scene.leave();
    });

    // Leave the scene if any other text is sent
    scene.on('text', (ctx) => ctx.scene.leave());

    return scene;
  }

  private escapeMarkdownV2(text: string): string {
    if (!text) return '';
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }
}
