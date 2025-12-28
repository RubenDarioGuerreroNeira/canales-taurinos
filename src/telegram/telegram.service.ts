import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Telegraf, Markup, session, Scenes } from 'telegraf';
import { ScraperService } from '../scraper/scraper.service';
import { ServitoroService } from '../scraper/servitoro.service';
import pTimeout from 'p-timeout';
import { ContactService } from '../contact/contact.service';
import { GeminiService } from '../gemini/gemini.service';
import { TransmisionesSceneService } from './scenes/transmisiones.scene';
import { CalendarioSceneService } from './scenes/calendario.scene';
import { EscalafonSceneService } from './scenes/escalafon.scene';
import { MyContext } from './telegram.interfaces'; // Mantener esta línea
import { escapeMarkdownV2, escapeMarkdownUrl, parseSpanishDate } from '../utils/telegram-format'; // Mantener esta línea
import { AmericaEventsService } from '../scraper/americaEvents.service'; // Eliminada la extensión .ts
import { WeatherService } from '../weather/weather.service';

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
    private escalafonSceneService: EscalafonSceneService,
    private americaEventsService: AmericaEventsService,
    private weatherService: WeatherService,
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

    return `${greeting}, ${userName}!`;
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

    this.bot.action('filter_america_cities', async (ctx) => {
      await ctx.answerCbQuery();
      await this.handleAmericaCitiesQuery(ctx);
    });

    this.bot.action('show_escalafon_action', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.scene.enter('escalafonScene');
    });

    this.bot.action('show_intro', async (ctx) => {
      await ctx.answerCbQuery();
      await this.sendBotIntroduction(ctx);
    });

    this.bot.action('show_contacto_action', async (ctx) => {
      await ctx.answerCbQuery();
      const contactMessage = this.contactService.getContactMessage();
      await ctx.reply(contactMessage, { parse_mode: 'MarkdownV2' });
    });

    this.bot.start((ctx) => {
      ctx.session = {};
      return this.sendBotIntroduction(ctx);
    });

    // --- INICIO: Lógica para Eventos en América ---

    // Manejador para "corridas en colombia" o "corridas en américa" y variantes
    this.bot.hears(
      /^(corridas en colombia|corridas en américa|eventos en américa|eventos en colombia|qué corridas hay en américa|qué corridas hay en colombia)$/i,
      (ctx) => this.handleAmericaCitiesQuery(ctx),
    );

    // Manejador para la acción de un botón de ciudad
    this.bot.action(/america_city_(.+)/, async (ctx) => {
      const city = ctx.match[1];
      this.logger.log(`Botón presionado para la ciudad: ${city}`);
      await ctx.answerCbQuery();
      await this.sendAmericaEventsForCity(ctx, city);
    });

    // Manejador para "quiero ver corridas en {ciudad}" o "corridas en {ciudad}"
    this.bot.hears(
      /^(quiero ver corridas en|corridas en|eventos en|carteles en) (.+)$/i,
      async (ctx) => {
        const city = ctx.match[2];
        // Si el usuario escribió algo como "colombia" o "américa", redirigimos al selector de ciudades
        if (/^(américa|colombia)$/i.test(city.trim())) {
          return this.handleAmericaCitiesQuery(ctx);
        }
        this.logger.log(`Detectada consulta directa para la ciudad: ${city}`);
        await this.sendAmericaEventsForCity(ctx, city);
      },
    );
    // Manejador para "América" o "Colombia" (como comando directo o palabra suelta)
    this.bot.hears(/^(américa|colombia)$/i, async (ctx) => {
      await this.handleAmericaCitiesQuery(ctx);
    });

    // --- FIN: Lógica para Eventos en América ---

    this.bot.hears(
      /^(que sabes hacer|qué sabes hacer|para que estas diseñado|para qué estás diseñado|ayuda|quien eres|quién eres)$/i,
      (ctx) => this.sendBotIntroduction(ctx)
    );

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
            Tu personalidad: Eres 'TauryBot' (antes conocido como Muletazo Bot), un asistente virtual experto en tauromaquia. Eres sumamente amable, formal y servicial. Siempre saludas por el nombre del usuario si está disponible.

            Tus funciones principales son:
            1.  **Transmisiones en TV**: Agendas de festejos televisados (proporcionados en el contexto abajo).
            2.  **Calendario de Temporada 2026**: Festejos programados en España y otras ferias importantes.
            3.  **Eventos en América**: Corridas en ciudades como Cali y Manizales (Colombia), incluyendo pronóstico del clima.
            4.  **Escalafón**: El ranking actualizado de matadores.

            Instrucciones clave:
            1.  **Búsqueda Específica vs. General**:
                - Si la pregunta es sobre un **lugar específico de América** (ej: "corridas en Cali"), redirige amablemente o menciona que puedes buscarlo. 
                - Si la pregunta es **general sobre la agenda de TV** ("¿qué hay hoy?", "canales"), usa [ACTION:GET_TRANSMISIONES].
                - Si te preguntan "¿qué sabes hacer?" o "¿quién eres?", responde de forma muy completa y amable describiendo tus 4 funciones principales y sugiriendo cómo usarlas.

            2.  **Contexto de América**: Si alguien pregunta por "Colombia" o "América", recuérdale que tienes información detallada de Cali y Manizales, incluyendo el clima para los próximos 7 días.

            3.  **Clima**: Menciona que ofreces pronósticos meteorológicos integrados para los eventos cercanos (menos de 7 días).

            4.  **Respuesta a Saludos**: Siempre responde con calidez. Ejemplo: "¡Hola [Nombre]! Es un gusto saludarte. Soy TauryBot, tu compañero taurino. ¿Deseas consultar las transmisiones, el calendario de temporada o quizás los eventos en América?"

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

  private async handleAmericaCitiesQuery(ctx: MyContext) {
    this.logger.log('Detectada consulta para ciudades de América.');
    const cities = await this.americaEventsService.getAvailableCities();
    if (cities.length === 0) {
      await ctx.reply(
        'Lo siento, no tengo información de corridas en América en este momento.',
      );
      return;
    }

    const buttons = cities.map((city) =>
      Markup.button.callback(city, `america_city_${city}`),
    );

    await ctx.reply(
      '¿En qué ciudad de América te gustaría consultar los eventos?',
      Markup.inlineKeyboard(buttons, { columns: 2 }),
    );
  }

  private async sendAmericaEventsForCity(ctx: MyContext, city: string) {
    try {
      const events = await this.americaEventsService.getEventsForCity(city);

      if (!events || events.length === 0) {
        await ctx.reply(
          `Lo siento no tengo esa respuesta por ahora.`,
        );
        return;
      }

      let message = `🎉 *Próximos eventos en ${escapeMarkdownV2(city)}:*\n\n`;

      // Usamos un bucle for-of para poder usar await dentro
      for (const event of events) {
        let weatherInfo = '';
        const eventDate = parseSpanishDate(event.fecha);
        if (eventDate) {
          weatherInfo = await this.weatherService.getWeatherForecastMessage(city, eventDate);
        }


        message += `🗓️ *Fecha:* ${escapeMarkdownV2(event.fecha)}\n`;
        if (event.descripcion) {
          message += `📝 *Descripción:* ${escapeMarkdownV2(
            event.descripcion,
          )}\n`;
        }
        message += `🐂 *Ganadería:* ${escapeMarkdownV2(event.ganaderia)}\n`;
        message += `👨‍鬥 *Toreros:* ${escapeMarkdownV2(
          event.toreros.join(', '),
        )}\n`;
        if (weatherInfo) {
          message += `${escapeMarkdownV2(weatherInfo)}\n`;
        }
        message += `\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n`;
      }

      await ctx.reply(message, { parse_mode: 'MarkdownV2' });

      // Mensaje de seguimiento para mejorar la interacción
      const userName = this.getUserName(ctx);
      await ctx.reply(
        escapeMarkdownV2(
          `¡Listo ${userName}! ¿Qué más te gustaría saber o qué otra info necesitas? 😊`,
        ),
        {
          parse_mode: 'MarkdownV2',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('📺 Transmisiones', 'show_transmisiones'),
              Markup.button.callback('🌎 Otras Ciudades', 'filter_america_cities'),
            ],
            [Markup.button.callback('🏠 Ir al Inicio', 'show_intro')],
          ]),
        },
      );
    } catch (error) {
      this.logger.error(
        `Error al obtener eventos para la ciudad: ${city}`,
        error.stack,
      );
      await ctx.reply(
        `Lo siento, no tengo esa respuesta por ahora.`,
      );
    }
  }

  /**
   * Envía una introducción completa y amable de todas las funcionalidades del bot.
   */
  private async sendBotIntroduction(ctx: MyContext) {
    const userName = this.getUserName(ctx);
    const greeting = this.getGreeting(userName); // Ya viene escapado

    const rawMessage =
      `${greeting}\n\n` +
      `Soy TauryBot, tu asistente taurino experto. He sido diseñado para ofrecerte absolutamente todo lo que necesitas para seguir la fiesta brava:\n\n` +
      `📺 *Transmisiones en Vivo*\n` +
      `Entérate de qué corridas se televisan, los horarios y los canales exactos.\n` +
      `💬 Prueba escribiendo: "agenda de TV" o "transmisiones"\n\n` +
      `🗓️ *Calendario de Temporada Española 2026*\n` +
      `Toda la programación de las ferias en España al alcance de tu mano.\n` +
      `💬 Prueba escribiendo: "temporada completa" o "calendario"\n\n` +
      `🌎 *Festejos en América*\n` +
      `Información detallada de ferias en América (como: Cali y Manizales) con *pronóstico del clima el día de la corrida*.\n` +
      `💬 Prueba escribiendo: "América", "corridas en Colombia" \n\n` +
      `🏆 *Escalafón Taurino 2025*\n` +
      `Mira quién lidera el ranking de toreros en la actualidad.\n` +
      `💬 Prueba escribiendo: "escalafón" o "ranking"\n\n` +
      `🧠 *Búsqueda con IA*\n` +
      `Pregúntame lo que quieras sobre historia taurina o toreros legendarios.\n` +
      `💬 Ejemplo: "¿Quién fue Joselito el Gallo?"\n\n` +
      `📞 *Contacto*\n` +
      `¿Quieres saber quién me diseñó o darnos tu opinión?\n` +
      `💬 Prueba escribiendo: "contacto"\n\n` +
      `¡Estoy a tu completa disposición! ¿Por dónde te gustaría empezar?`;

    // Escapamos todo y luego "re-activamos" el formato de negrita (*)
    const welcomeMessage = escapeMarkdownV2(rawMessage).replace(/\\\*/g, '*');

    await ctx.reply(welcomeMessage, {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('📺 Transmisiones', 'show_transmisiones'),
          Markup.button.callback('🗓️ Temporada', 'show_temporada'),
        ],
        [
          Markup.button.callback('🌎 América', 'filter_america_cities'),
          Markup.button.callback('🏆 Escalafón', 'show_escalafon_action'),
        ],
        [
          Markup.button.callback(
            '📞 Contacto / Creador',
            'show_contacto_action',
          ),
        ],
      ]),
    });
  }
}
