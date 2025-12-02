import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Telegraf, Markup, session, Scenes } from 'telegraf';
import { ScraperService } from '../scraper/scraper.service';
import { ServitoroService } from '../scraper/servitoro.service';
import pTimeout from 'p-timeout';
import { ContactService } from '../contact/contact.service';
import { GeminiService } from '../gemini/gemini.service';
import { TransmisionesSceneService } from './scenes/transmisiones.scene';
import { CalendarioSceneService } from './scenes/calendario.scene';
import { AmericaSceneService } from './scenes/america.scene';
import { EscalafonSceneService } from './scenes/escalafon.scene';
import { MyContext } from './telegram.interfaces';
import {
  escapeMarkdownV2,
  escapeMarkdownUrl,
} from '../utils/telegram-format';

@Injectable()
export class TelegramService implements OnModuleInit {
  private bot: Telegraf<MyContext>;
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    private scraperService: ScraperService,
    private servitoroService: ServitoroService,
    private contactService: ContactService,
    private geminiService: GeminiService,
    private transmisionesSceneService: TransmisionesSceneService,
    private calendarioSceneService: CalendarioSceneService,
    private americaSceneService: AmericaSceneService,
    private escalafonSceneService: EscalafonSceneService,
  ) {
    const token = process.env.BOT_TOKEN;
    if (!token) {
      throw new Error(
        '¡El BOT_TOKEN de Telegram no está definido en el archivo .env!',
      );
    }

    this.bot = new Telegraf<MyContext>(token);

    const stage = new Scenes.Stage<MyContext>([
      this.transmisionesSceneService.create(),
      this.calendarioSceneService.create(),
      this.americaSceneService.create(),
      this.escalafonSceneService.create(),
    ]);

    this.bot.use(session(), stage.middleware());
  }

  onModuleInit() {
    this.setupCommands();
    console.log('Servicio de Telegram inicializado y comandos configurados.');
  }

  getBot(): Telegraf<MyContext> {
    return this.bot;
  }

  async getWebhookMiddleware() {
    return this.bot.webhookCallback('/api/telegram');
  }

  private getUserName(ctx: MyContext): string {
    return ctx.from?.first_name || 'aficionado';
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

    return `${greeting}, ${escapeMarkdownV2(userName)}!`;
  }

  private setupCommands() {
    this.bot.command('transmisiones', (ctx) =>
      this.handleTransmisionesQuery(ctx),
    );
    this.bot.command('filtrar', (ctx) => this.handleTransmisionesQuery(ctx));

    this.bot.command('clearcache', async (ctx) => {
      // Limpiamos la caché de ambas fuentes para simplificar.
      this.scraperService.clearCache();
      this.servitoroService.clearCache();
      console.log(
        'TelegramService: La caché de El Muletazo y Servitoro ha sido limpiada.',
      );
      const userName = this.getUserName(ctx);
      await ctx.reply(
        `¡Hola ${escapeMarkdownV2(userName)}! 🧹 La caché de transmisiones y del calendario de temporada ha sido limpiada. ¡Intenta tu búsqueda de nuevo!`,
      );
    });

    this.bot.command('calendario', async (ctx) => {
      await this.handleCalendarioQuery(ctx);
    });

    this.bot.command('escalafon', async (ctx) => {
      await ctx.scene.enter('escalafonScene');
    });

    this.bot.command('contacto', async (ctx) => {
      const contactMessage = this.contactService.getContactMessage();
      await ctx.reply(contactMessage, { parse_mode: 'MarkdownV2' });
    });

    // Acción para mostrar el calendario de la temporada completa (Servitoro)
    this.bot.action('show_temporada', async (ctx) => {
      await ctx.answerCbQuery();
      const userName = this.getUserName(ctx);
      await ctx.reply(
        `¡Hola ${escapeMarkdownV2(userName)}! 📡 Consultando el calendario taurino de Servitoro para la temporada 2026...`,
      );
      try {
        // Envolvemos la llamada al scraper en un timeout de 85 segundos.
        const eventos = await pTimeout(
          this.servitoroService.getCalendarioTaurino(),
          85000,
        );

        if (!eventos || eventos.length === 0) {
          await ctx.reply(
            `Lo siento ${escapeMarkdownV2(userName)}, no se encontraron eventos en el calendario en este momento.`,
          );
          return;
        }
        ctx.scene.session.servitoroEvents = eventos;
        ctx.scene.session.currentCalPage = 0;
        ctx.scene.session.currentCalFilter = undefined;
        await ctx.scene.enter('calendarioScene');
      } catch (error) {
        this.logger.error(
          'Timeout al obtener el calendario de Servitoro',
          error.stack,
        );
        await ctx.reply(
          `Lo siento ${escapeMarkdownV2(userName)}, la consulta está tardando más de lo esperado. Por favor, inténtalo de nuevo en un par de minutos.`,
        );
      }
    });

    // Acción para mostrar las transmisiones
    this.bot.action('show_transmisiones', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.scene.enter('transmisionesScene');
    });

    this.bot.start((ctx) => {
      ctx.session = {};
      const userName = ctx.from.first_name || 'aficionado';

      const welcomeMessage =
        `${escapeMarkdownV2('¡Hola')} ${escapeMarkdownV2(userName)}${escapeMarkdownV2('!')} 👋 ${escapeMarkdownV2('¡Bienvenido/a a Muletazo Bot!')} 🎯\n\n` +
        `Soy tu asistente personal para todo lo relacionado con el mundo taurino\\. Estoy aquí para ayudarte a estar siempre informado sobre corridas, festejos y transmisiones\\.\n\n` +
        `*📺 Transmisiones en Vivo*\n` +
        `Consulta qué corridas se transmiten por TV y en qué canales\\.\n` +
        `${escapeMarkdownV2('💬 Escribe: "transmisiones" o "agenda de TV"')}\n\n` +
        `*🗓️ Calendario de la Temporada Española 2026*\n` +
        `Revisa todos los festejos programados para la temporada completa\\.\n` +
        `${escapeMarkdownV2('💬 Escribe: "calendario" o "temporada completa"')}\n\n` +
        `*🌎 Festejos en América*\n` +
        `Descubre las corridas programadas en países de América como Colombia\\.\n` +
        `${escapeMarkdownV2('💬 Escribe: "América" o "corridas en Colombia"')}\n\n` +
        `*🏆 Escalafón Taurino*\n` +
        `Consulta el ranking actualizado de matadores de toros\\.\n` +
        `${escapeMarkdownV2('💬 Escribe: "escalafón" o "ranking de toreros"')}\n\n` +
        `*💬 Conversación Natural*\n` +
        `También puedes hacerme preguntas sobre tauromaquia y te responderé con gusto\\.\n` +
        `${escapeMarkdownV2('💬 Ejemplo: "¿Quien fue Manolete?"')}\n\n` +
        `*📞 Contacto*\n` +
        `${escapeMarkdownV2('¿Tienes sugerencias o comentarios?')}\n` +
        `${escapeMarkdownV2('💬 Escribe: "contacto" para saber cómo comunicarte con mi creador')}\n\n` +
        `${escapeMarkdownV2('¡Estoy a tu servicio!')} ${escapeMarkdownV2('¿En qué puedo ayudarte hoy?')} 😊`;

      ctx.reply(welcomeMessage, { parse_mode: 'MarkdownV2' });
    });

    this.bot.on('text', async (ctx) => {
      const userText = ctx.message.text.trim();
      if (userText.startsWith('/')) return;

      const isContactQuery =
        /quien (hizo|creo|desarrollo) este bot|creador|desarrollador|autor|sugerencia|feedback|contactar|escribirle/i.test(
          userText,
        );
      if (isContactQuery) {
        console.log(
          `[Mensaje Recibido] Detectada consulta de contacto: "${userText}"`,
        );
        const userName = this.getUserName(ctx);
        const contactMessage = this.contactService.getContactMessage();
        await ctx.reply(
          `${escapeMarkdownV2(`¡Hola ${userName}!`)} ${contactMessage}`,
          { parse_mode: 'MarkdownV2' },
        );
        return;
      }

      // Manejar consulta de calendario en lenguaje natural
      const isCalendarioDeTransmisionesQuery =
        /calendario de trasmisiones|calendario de las trasmisiones|calendario de los festejos/i.test(
          userText,
        );
      if (isCalendarioDeTransmisionesQuery) {
        await this.handleTransmisionesQuery(ctx);
        return;
      }

      // Manejar consulta de festejos en América
      const isAmericaQuery =
        /américa|america|festejos en américa|corridas en américa|corridas en colombia|corridas en calí|corridas en manizales|Corridas en Colombia|carteles en colombia|Carteles en Colombia/i.test(
          userText,
        );
      if (isAmericaQuery) {
        await ctx.scene.enter('americaScene');
        return;
      }

      // Manejar consulta de escalafón (variantes: "escalafón", "escalafon", "quiero ver el escalafón", "cuál es el escalafón", etc.)
      const isEscalafonQuery =
        /(?:\b(escalaf[oó]n|escalafon|ranking|matadores|toreros)\b|quiero ver el escalaf[oó]n|cual(?:|\s+es) el escalaf[oó]n|cu[aá]l es el escalaf[oó]n)/i.test(
          userText,
        );
      if (isEscalafonQuery) {
        await ctx.scene.enter('escalafonScene');
        return;
      }

      const isCalendarioQuery =
        /calendario|temporada completa|carteles de la temporada|carteles de toda la temporada/i.test(
          userText,
        );
      if (isCalendarioQuery) {
        await this.handleCalendarioQuery(ctx);
        return;
      }

      // Manejar consulta de transmisiones en lenguaje natural
      const isTransmisionesQuery =
        /agenda de festejos|festejos en tv|transmisones|puedo ver las transmisones|corridas que televisan|agenda televisiva/i.test(
          userText,
        );
      if (isTransmisionesQuery) {
        await this.handleTransmisionesQuery(ctx);
        return;
      }

      try {
        if (!ctx.session) ctx.session = {};
        const { from, session } = ctx;

        console.log(
          `[Mensaje Recibido] De: ${from.first_name} (${from.id}) | Mensaje: "${userText}" | Sesión: ${session.geminiChat ? 'activa' : 'nueva'}`,
        );

        if (!session?.geminiChat) {
          console.log('Creando nueva sesión de chat con Gemini...');
          ctx.session.geminiChat = this.geminiService.createChatSession();
        }

        const chat = session.geminiChat;
        if (!chat) {
          console.error('La sesión de chat no se pudo inicializar.');
          const userName = this.getUserName(ctx);
          await ctx.reply(
            `Lo siento ${escapeMarkdownV2(userName)}, hubo un problema al iniciar la conversación. Por favor, intenta de nuevo.`,
          );
          return;
        }

        let prompt = userText;
        const isAgendaQuery =
          /cartel|fecha|corrida|canal|agenda|transmisionfestejo|transmisi|toros/i.test(
            userText,
          );

        if (isAgendaQuery) {
          await ctx.reply(
            this.getRandomThinkingMessage(
              escapeMarkdownV2(ctx.from.first_name || 'aficionado'),
            ),
          );
          const eventos = await this.scraperService.scrapeTransmisiones();
          let scraperContext = '';
          if (eventos.length > 0) {
            scraperContext =
              '\n\n--- INICIO DEL CONTEXTO ---\n' +
              'Usa esta lista de festejos de "El Muletazo" para responder preguntas generales sobre la agenda:\n' +
              eventos
                .map((ev) => `- Fecha: ${ev.fecha}, Desc: ${ev.descripcion}`)
                .join('\n') +
              '\n--- FIN DEL CONTEXTO ---';
          }

          prompt = `
            Tu personalidad: Eres 'Muletazo Bot', un asistente virtual experto en tauromaquia. Eres amable, formal y muy servicial.

            Instrucciones clave:
            1.  **Búsqueda Específica vs. General**:
                - Si la pregunta es sobre un **lugar específico** (ej: "carteles en Mérida, Venezuela"), **IGNORA EL CONTEXTO** y busca en la web. Responde con "Voy a buscar en la red..." y luego presenta los resultados.
                - Si la pregunta es **general sobre la agenda** ("¿qué corridas hay?", "dame fechas", "¿dónde las puedo ver?", "canales", "filtrar"), responde ÚNICA Y EXCLUSIVAMENTE con el texto: [ACTION:GET_TRANSMISIONES]. No añadas nada más.

            2.  **Validación de Fechas**: Siempre que des una fecha, asegúrate de que sea posterior a la fecha actual (${new Date().toLocaleDateString('es-ES')}). Descarta eventos pasados.

            3.  **Respuesta a Saludos**: Si el usuario solo saluda (ej: "Hola", "Buenas"), responde de forma cordial y recuérdale que puede usar 'transmisiones' ó 'calendario' para obtener más información.
 
            4.  **Sin Resultados**: Si después de buscar no encuentras información para un lugar específico, responde amablemente: "Lo siento, aún no dispongo de información sobre festejos en esa localidad. Vuelve a consultarme más adelante."

            5.  **Otras Preguntas**: Para preguntas generales sobre tauromaquia (historia, toreros, etc.), responde de forma cordial y precisa.

            ${scraperContext}

            Conversación actual:
            Usuario: "${userText}"
            Tu respuesta:
          `;
        }

        if (!isAgendaQuery) {
          await ctx.reply(
            this.getRandomThinkingMessage(
              escapeMarkdownV2(ctx.from.first_name || 'aficionado'),
            ),
          );
        }

        // Lógica de reintento para Gemini
        let attempts = 0;
        const maxAttempts = 3;
        let geminiResponse = '';
        let success = false;

        while (attempts < maxAttempts && !success) {
          try {
            attempts++;
            if (attempts > 1) {
              console.log(
                `Reintentando conexión con Gemini (Intento ${attempts}/${maxAttempts})...`,
              );
            }

            let result = await chat.sendMessage(prompt);
            geminiResponse = result.response.text().trim();
            success = true; // Si llegamos aquí, fue exitoso
          } catch (error) {
            console.error(`Error en intento ${attempts} con Gemini:`, error);
            if (attempts === maxAttempts) {
              // Si fallamos en el último intento, lanzamos el error para que lo capture el catch externo o manejamos aquí
              throw error;
            }
            // Esperar un poco antes de reintentar (backoff exponencial simple o fijo)
            await new Promise((resolve) =>
              setTimeout(resolve, 1000 * attempts),
            );
          }
        }

        console.log(`[Respuesta de Gemini] ${geminiResponse}`);

        if (geminiResponse === '[ACTION:GET_TRANSMISIONES]') {
          await ctx.scene.enter('transmisionesScene');
        } else if (geminiResponse.toLowerCase().includes('voy a buscar')) {
          const userName = this.getUserName(ctx);
          await ctx.reply(
            `¡Hola ${escapeMarkdownV2(userName)}! ${geminiResponse}`,
          );

          // Para la segunda llamada (resultados de búsqueda), también podríamos querer reintentos,
          // pero por ahora lo dejaremos simple o aplicamos la misma lógica si es crítico.
          // Asumimos que si la primera pasó, la conexión es estable, pero idealmente se abstraería en un método.
          try {
            const result = await chat.sendMessage(
              'Ok, por favor, dame los resultados que encontraste.',
            );
            geminiResponse = result.response.text().trim();
            console.log(`[Respuesta de Gemini 2] ${geminiResponse}`);
            await ctx.reply(
              `¡Hola ${escapeMarkdownV2(userName)}! ${geminiResponse}\n\n¿En que puedo ayudarte?, Puedes ver las transmisiones en vivo escribiendo "transmisiones" o consultar el calendario completo de la temporada 2026  escribiendo "calendario".`,
            );
          } catch (secondError) {
            console.error('Error en la segunda llamada a Gemini:', secondError);
            await ctx.reply(
              `Tuve un pequeño problema obteniendo los detalles finales, pero sigo aquí.`,
            );
          }
        } else {
          const userName = this.getUserName(ctx);
          await ctx.reply(
            `¡Hola ${escapeMarkdownV2(userName)}! ${geminiResponse}\n\n¿En que puedo ayudarte?, Puedes ver las transmisiones en vivo escribiendo "transmisiones" o consultar el calendario completo de la temporada 2026 escribiendo "calendario".`,
          );
        }
      } catch (error) {
        console.error(
          'Error crítico al contactar con Gemini tras reintentos:',
          error,
        );
        if (ctx.session) ctx.session.geminiChat = undefined;
        const userName = this.getUserName(ctx);

        let errorMessage = `Lo siento ${escapeMarkdownV2(userName)}, estoy teniendo problemas para conectar con mi inteligencia.`;

        // Mensajes de error más específicos según el tipo de error (si es posible identificarlo)
        if (error.message && error.message.includes('SAFETY')) {
          errorMessage = `Lo siento ${escapeMarkdownV2(userName)}, no puedo procesar esa solicitud debido a mis filtros de seguridad.`;
        } else if (
          error.message &&
          (error.message.includes('429') || error.message.includes('Quota'))
        ) {
          errorMessage = `Lo siento ${escapeMarkdownV2(userName)}, estoy un poco saturado en este momento. Por favor intenta de nuevo en unos segundos.`;
        }

        await ctx.reply(
          `${errorMessage} Por favor, intenta usar el comando /transmisiones directamente o reinicia la conversación con /start.`,
        );
      }
    });
  }

  private async handleCalendarioQuery(ctx: MyContext) {
    // En lugar de ir directo a una función, preguntamos al usuario qué calendario quiere ver.
    const userName = this.getUserName(ctx);
    await ctx.reply(
      `¡Claro ${escapeMarkdownV2(userName)}! ¿Qué calendario te gustaría consultar?`,
      Markup.inlineKeyboard([
        Markup.button.callback('Transmisiones 📺', 'show_transmisiones'),
        Markup.button.callback('Temporada 2026 🗓️ ', 'show_temporada'),
      ]),
    );
  }

  private async handleTransmisionesQuery(ctx: MyContext) {
    await ctx.scene.enter('transmisionesScene');
  }

  private getRandomThinkingMessage(userName: string = 'aficionado'): string {
    const messages = [
      `Procesando tu solicitud, ${userName}..... 👍`,
      `Revisando tu Solicitud,  ${userName}...⏳`,
      `Un momento porfavor , ${userName}...🕗`,
      `Permíteme un instante..., ${userName} 🕗`,
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  }
}
