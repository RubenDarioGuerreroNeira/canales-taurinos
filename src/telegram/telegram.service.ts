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
              this.getChannelNameFromUrl(link.url, index),
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

        await ctx.reply(
          '📌 Fuente: El Muletazo. ¡Suerte para todos!\n\n¿Hay algo más en lo que pueda ayudarte?',
        );
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
      const greeting = this.getGreeting(userName);

      const welcomeOptions = [
        'Soy tu asistente taurino. Usa el comando /transmisiones para ver los próximos eventos en TV o simplemente pregúntame algo.',
        'Estoy a tu disposición para cualquier consulta sobre el mundo del toro. Puedes empezar con /transmisiones.',
        '¿Listo para conocer la agenda taurina? Usa /transmisiones o hazme una pregunta sobre este arte.',
        '¡Qué alegría verte! Pregúntame por la agenda de festejos o lo que desees saber sobre la tauromaquia.',
      ];

      const randomWelcome =
        welcomeOptions[Math.floor(Math.random() * welcomeOptions.length)];
      const welcomeMessage = `${greeting}\n\n${randomWelcome}`;
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
          Tu personalidad: Eres 'Muletazo Bot', un asistente virtual con gran conocimiento y pasión por la tauromaquia. Tienes una manera de hablar amable, educada y algo formal, pero también sabes adaptarte al tono del usuario. Disfrutas compartiendo tu fascinación por el mundo taurino y siempre estás dispuesto a compartir datos curiosos o responder preguntas sobre este arte. 
          Tu objetivo: Ayudar a los usuarios con información sobre corridas de toros, festejos y cualquier aspecto relacionado con la tauromaquia, y también mantener una conversación cordial y enriquecedora sobre este tema.

          Instrucciones clave:
          1. Si el usuario te pregunta sobre las próximas corridas, festejos, transmisiones, agenda o cualquier tema relacionado, responde ÚNICA Y EXCLUSIVAMENTE con el texto: [ACTION:GET_TRANSMISIONES]. No añadas nada más.
          2. Si el usuario te saluda o hace una pregunta general sobre tauromaquia (¿quién es Manolete?, ¿qué es un quite?, etc.), responde con amabilidad, brevedad y claridad. A veces puedes incluir algún detalle interesante o un dato curioso para mantener la conversación amena.
          3. Si el usuario hace preguntas que no están relacionadas con la tauromaquia, responde con educación y cordialidad, recordándole amablemente que tu especialidad es la tauromaquia y que no puedes ofrecer ayuda con temas ajenos a este mundo.

          Conversación actual:
          Usuario: "${userText}"
          Tu respuesta:
        `;

        const result = await model.generateContent(chatPrompt);
        const geminiResponse = result.response.text().trim();

        console.log(`[Respuesta de Gemini] ${geminiResponse}`);

        // Comprobamos si Gemini nos pide ejecutar la acción de scraping
        if (geminiResponse === '[ACTION:GET_TRANSMISIONES]') {
          // Solo mostramos el mensaje de "pensando" si vamos a realizar una acción larga
          await ctx.reply(this.getRandomThinkingMessage());
          await handleTransmisiones(ctx);
        } else {
          // Si no, simplemente enviamos la respuesta de Gemini al usuario
          await ctx.reply(`${geminiResponse}\n\n¿Puedo ayudarte en algo más?`);
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

  /**
   * Genera un nombre de canal descriptivo a partir de una URL.
   * @param url La URL del enlace de transmisión.
   * @param index El índice del botón, para usar como fallback.
   * @returns Un nombre corto para el canal.
   */
  private getChannelNameFromUrl(url: string, index: number): string {
    if (!url) return `Canal ${index + 1}`;

    const lowerUrl = url.toLowerCase();

    if (lowerUrl.includes('canalsur.es')) return 'Canal Sur';
    if (lowerUrl.includes('telemadrid.es')) return 'T.Madrid';
    if (lowerUrl.includes('cmmedia.es')) return 'CMM';
    if (lowerUrl.includes('apuntmedia.es')) return 'À Punt';
    if (lowerUrl.includes('ondateve')) return 'OndaTevé';
    if (lowerUrl.includes('meditv')) return 'MediTv';
    if (lowerUrl.includes('torosenespana.com')) return 'TorosEspaña Play';
    if (lowerUrl.includes('one-toro.com')) return 'OneToro';

    // Fallback: intentar extraer el nombre del dominio
    try {
      const hostname = new URL(url).hostname;
      const parts = hostname.replace('www.', '').split('.');
      return parts.length > 1 ? parts[0] : `Canal ${index + 1}`;
    } catch {
      return `Canal ${index + 1}`;
    }
  }

  private getRandomThinkingMessage(): string {
    const messages = [
      'Pensando... 🧠',
      'Consultando los carteles... 📜',
      'Un momento, aficionado...',
      'Revisando la agenda... 🗓️',
      'Permíteme un instante...',
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  }
}
