import {
  Injectable,
  OnModuleInit,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Telegraf, Markup } from 'telegraf';
import { ScraperService } from '../scraper/scraper.service';

@Injectable()
export class TelegramService implements OnModuleInit, OnApplicationBootstrap {
  private bot: Telegraf;

  constructor(private scraperService: ScraperService) {
    const token = process.env.BOT_TOKEN;
    if (!token) {
      throw new Error(
        '¡El BOT_TOKEN de Telegram no está definido en el archivo .env!',
      );
    }
    this.bot = new Telegraf(token);
  }

  onModuleInit() {
    this.setupCommands();
    console.log('Servicio de Telegram inicializado y comandos configurados.');
  }

  onApplicationBootstrap() {
    // Iniciar el bot. NestJS se asegura de que esto se llame en el momento adecuado.
    this.bot.launch();
    console.log('🤖 Bot de Telegram iniciado con long polling...');
  }

  getBot(): Telegraf {
    return this.bot;
  }

  private getGreeting(userName: string): string {
    const hour = new Date().getHours();
    let greeting = '¡Hola';

    if (hour >= 5 && hour < 12) {
      greeting = '¡Buenos días';
    } else if (hour >= 12 && hour < 20) {
      greeting = '¡Buenas tardes';
    } else {
      greeting = '¡Buenas noches';
    }

    return `${greeting}, ${userName}!`;
  }

  private setupCommands() {
    this.bot.command('transmisiones', async (ctx) => {
      try {
        await ctx.reply('Buscando transmisiones, por favor espera...');
        const eventos = await this.scraperService.scrapeTransmisiones();
        if (!eventos.length) {
          return ctx.reply(
            '⚠️ No se encontraron transmisiones por el momento.',
          );
        }

        for (const ev of eventos.slice(0, 10)) {
          const mensaje = `🗓 *${ev.fecha}*\n_${ev.descripcion}_`;

          const botones = ev.enlaces.map((link, index) =>
            Markup.button.url(
              link.texto.toLowerCase().includes('pulse aquí')
                ? `Ver Canal ${index + 1}`
                : link.texto,
              link.url,
            ),
          );

          if (botones.length > 0) {
            await ctx.reply(mensaje, {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard(botones),
            });
          } else {
            await ctx.reply(mensaje, { parse_mode: 'Markdown' });
          }
        }

        await ctx.reply('📌 Fuente: El Muletazo. ¡Suerte para todos!');
      } catch (err) {
        console.error('Error en /transmisiones:', err.message);
        await ctx.reply(
          '❌ Error al obtener las transmisiones. Inténtalo más tarde.',
        );
      }
    });

    this.bot.start((ctx) => {
      const userName = ctx.from.first_name || 'aficionado';
      const welcomeMessage = `${this.getGreeting(
        userName,
      )}\n\nSoy tu asistente taurino. Usa el comando /transmisiones para ver los próximos eventos en TV.`;
      ctx.reply(welcomeMessage);
    });

    // Middleware para registrar todos los mensajes entrantes
    // Lo movemos al final para que no interfiera con los comandos
    this.bot.use((ctx, next) => {
      // Añadimos una comprobación para asegurarnos de que ctx.from existe
      if (ctx.from && ctx.message) {
        if ('text' in ctx.message) {
          console.log(
            `[Mensaje Recibido] De: ${ctx.from.first_name} (${ctx.from.id}) | Mensaje: "${ctx.message.text}"`,
          );
        } else {
          console.log(
            `[Mensaje Recibido] De: ${ctx.from.first_name} (${ctx.from.id}) | Tipo: no textual`,
          );
        }
      }
      // Llama al siguiente middleware (o al manejador de comandos)
      return next();
    });
  }
}
