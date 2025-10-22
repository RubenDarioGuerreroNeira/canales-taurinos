import {
  Injectable,
  OnModuleInit,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Telegraf, Markup } from 'telegraf';
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from '@google/generative-ai';
import { ScraperService } from '../scraper/scraper.service';

@Injectable()
export class TelegramService implements OnModuleInit, OnApplicationBootstrap {
  private bot: Telegraf;
  private genAI: GoogleGenerativeAI;

  constructor(private scraperService: ScraperService) {
    const token = process.env.BOT_TOKEN;
    if (!token) {
      throw new Error(
        '¡El BOT_TOKEN de Telegram no está definido en el archivo .env!',
      );
    }
    const geminiApiKey = process.env.GOOGLE_API_KEY;
    if (!geminiApiKey) {
      throw new Error(
        '¡La GOOGLE_API_KEY de Gemini no está definida en el archivo .env!',
      );
    }

    this.bot = new Telegraf(token);
    this.genAI = new GoogleGenerativeAI(geminiApiKey);
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
    const handleTransmisiones = async (ctx) => {
      try {
        await ctx.reply('Buscando transmisiones, por favor espera...');
        const eventos = await this.scraperService.scrapeTransmisiones();
        // Log raw events for debugging when invoked via Gemini or command
        console.log(
          'TelegramService: transmisiones crudas recibidas ->',
          JSON.stringify(eventos, null, 2),
        );
        if (!eventos.length) {
          return ctx.reply(
            '⚠️ No se encontraron transmisiones por el momento.',
          );
        }

        for (const ev of eventos.slice(0, 10)) {
          // Escapar contenido para MarkdownV2 y evitar que caracteres rompan el formato
          const mensaje = `🗓 *${this.escapeMarkdown(ev.fecha)}*\n_${this.escapeMarkdown(ev.descripcion)}_`;

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
              parse_mode: 'MarkdownV2',
              ...Markup.inlineKeyboard(botones),
            });
          } else {
            await ctx.reply(mensaje, { parse_mode: 'MarkdownV2' });
          }
        }

        await ctx.reply('📌 Fuente: El Muletazo. ¡Suerte para todos!');
      } catch (err) {
        console.error('Error en /transmisiones:', err.message);
        await ctx.reply(
          '❌ Error al obtener las transmisiones. Inténtalo más tarde.',
        );
      }
    };

    this.bot.command('transmisiones', handleTransmisiones);

    this.bot.command('clearcache', async (ctx) => {
      this.scraperService.clearCache();
      console.log('TelegramService: La caché del scraper ha sido limpiada.');
      await ctx.reply(
        '🧹 La caché de transmisiones ha sido limpiada. ¡Intenta tu búsqueda de nuevo!',
      );
    });

    this.bot.start((ctx) => {
      const userName = ctx.from.first_name || 'aficionado';
      const welcomeMessage = `${this.getGreeting(
        userName,
      )}\n\nSoy tu asistente taurino. Usa el comando /transmisiones para ver los próximos eventos en TV.`;
      ctx.reply(welcomeMessage);
    });

    // Middleware para manejar todos los mensajes de texto que no son comandos
    this.bot.on('text', async (ctx) => {
      const userText = ctx.message.text;
      const from = ctx.from;

      console.log(
        `[Mensaje Recibido] De: ${from.first_name} (${from.id}) | Mensaje: "${userText}"`,
      );

      // Ignorar si es un comando, ya que tienen su propio manejador
      if (userText.startsWith('/')) {
        return;
      }

      await ctx.reply('Pensando... 🧠');

      try {
        // Usamos el modelo recomendado 'latest' para asegurar compatibilidad.
        const model = this.genAI.getGenerativeModel({
          model: 'gemini-2.0-flash',

          // Es una buena práctica configurar la seguridad para evitar bloqueos inesperados.
          safetySettings: [
            {
              category: HarmCategory.HARM_CATEGORY_HARASSMENT,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
          ],
        });

        const chatPrompt = `
          Tu personalidad: Eres 'Muletazo Bot', un asistente virtual experto y apasionado por la tauromaquia. Eres siempre amable, servicial y un poco formal.
          Tu objetivo: Ayudar a los usuarios con información sobre corridas de toros y conversar amigablemente sobre el mundo taurino.

          Instrucciones clave:
          1.  Si el usuario te pregunta sobre las próximas corridas, festejos, transmisiones, agenda o cualquier cosa similar, responde ÚNICA Y EXCLUSIVAMENTE con el texto: [ACTION:GET_TRANSMISIONES]. No añadas nada más.
          2.  Si el usuario te saluda o hace una pregunta general sobre tauromaquia (¿quién es Manolete?, ¿qué es un quite?), responde de forma amable y concisa.
          3.  Si el usuario pregunta algo que no tiene que ver con toros, responde educadamente que tu especialidad es la tauromaquia y que no puedes ayudar con ese tema.

          Conversación actual:
          Usuario: "${userText}"
          Tu respuesta:
        `;

        const result = await model.generateContent(chatPrompt);
        const geminiResponse = result.response.text().trim();

        console.log(`[Respuesta de Gemini] ${geminiResponse}`);

        // Comprobamos si Gemini nos pide ejecutar la acción de scraping
        if (geminiResponse === '[ACTION:GET_TRANSMISIONES]') {
          await handleTransmisiones(ctx);
        } else {
          // Si no, simplemente enviamos la respuesta de Gemini al usuario
          await ctx.reply(geminiResponse);
        }
      } catch (error) {
        console.error('Error al contactar con Gemini:', error);
        await ctx.reply(
          'Lo siento, estoy teniendo problemas para conectar con mi inteligencia. Por favor, intenta usar el comando /transmisiones directamente.',
        );
      }
    });
  }

  // Escape text for Telegram MarkdownV2
  private escapeMarkdown(text: string): string {
    if (!text) return '';
    return text
      .replace(/([_()*\[\]~`>#+\-=|{}.!\\])/g, '\\$1')
      .replace(/\n/g, '\\n');
  }
}
