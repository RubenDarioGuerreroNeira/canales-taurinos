import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import axios from 'axios';
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
import {
  escapeMarkdownV2,
  escapeMarkdownUrl,
  parseSpanishDate,
} from '../utils/telegram-format'; // Mantener esta línea
import { AmericaEventsService } from '../scraper/americaEvents.service'; // Eliminada la extensión .ts
import { WeatherService } from '../weather/weather.service';
import { SevillaService } from '../scraper/sevilla.service';

@Injectable()
export class TelegramService implements OnModuleInit {
  private bot: Telegraf<MyContext>;
  private readonly logger = new Logger(TelegramService.name);

  // Constantes de expresiones regulares para validación y pruebas
  public static readonly IS_CALENDARIO_TRANSMISIONES_QUERY = /calendario de transmisiones|calendario de las transmisiones|calendario de los festejos/i;
  public static readonly IS_TRANSMISIONES_QUERY = /\btransmisi[oó]n(es)?\b|agenda de festejos|festejos en tv|corridas que televisan|agenda televisiva/i;

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
    private sevillaService: SevillaService,
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

    this.bot.command('sevilla', async (ctx) => {
      await this.handleSevillaQuery(ctx);
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
        `¡Hola ${escapeMarkdownV2(userName)}! 📡 Consultando el calendario taurino para la temporada 2026...`,
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

    this.bot.action('sevilla', async (ctx) => {
      await ctx.answerCbQuery();
      await this.handleSevillaQuery(ctx);
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
      if (!ctx.session) ctx.session = {};
      ctx.session.greeted = true;
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
    this.bot.hears(
      /^(américa|colombia|Venezuela|Colombia|venezuela)$/i,
      async (ctx) => {
        await this.handleAmericaCitiesQuery(ctx);
      },
    );

    // --- FIN: Lógica para Eventos en América --

    // Manejador para Sevilla
    this.bot.hears(
      /^(sevilla|maestranza|feria de abril|toros en sevilla)$/i,
      async (ctx) => {
        await this.handleSevillaQuery(ctx);
      },
    );

    this.bot.hears(
      /^(que sabes hacer|qué sabes hacer|para que estas diseñado|para qué estás diseñado|ayuda|quien eres|quién eres)$/i,
      (ctx) => {
        ctx.session.greeted = true;
        return this.sendBotIntroduction(ctx);
      },
    );

    // Manejador de Notas de Voz (Multimodalidad)
    this.bot.on('voice', async (ctx) => {
      await this.handleVoiceMessage(ctx);
    });

    this.bot.on('text', async (ctx) => {
      const userText = ctx.message.text.trim();
      if (userText.startsWith('/')) return;

      const userName = this.getUserName(ctx);

      // --- MEJORA: Respuesta humana a saludos (evita Gemini para saludos simples) ---
      const isSimpleGreeting = /^(hola|hi|buenas|buenos dias|buenas tardes|buenas noches|hola taurybot|hola bot)$/i.test(userText);
      if (isSimpleGreeting) {
        if (!ctx.session.greeted) {
          ctx.session.greeted = true;
          return this.sendBotIntroduction(ctx);
        }
        
        // Si ya fue saludado, le damos una respuesta humana cálida que recuerde sus funciones
        await ctx.reply(`¡Hola de nuevo, ${userName}! 👋 Aquí sigo a tu disposición para lo que necesites.\n\nRecuerda que puedo detallarte las transmisiones por TV con sus carteles y ganaderías, ofrecerte el calendario de la temporada 2026 con filtros por ciudad o mes, mostrarte el escalafón actualizado o informarte sobre las ferias en América.\n\n¿Por dónde te gustaría que continuáramos hoy nuestra charla taurina?`, {
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📺 Transmisiones', 'show_transmisiones'), Markup.button.callback('🗓️ Temporada', 'show_temporada')],
            [Markup.button.callback('🏆 Escalafón', 'show_escalafon_action'), Markup.button.callback('🌎 América', 'filter_america_cities')]
          ])
        });
        return;
      }

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
        /calendario de transmisiones|calendario de las transmisiones|calendario de los festejos/i.test(
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
        /\btransmisi[oó]n(es)?\b|agenda de festejos|festejos en tv|puedo ver las transmisiones|corridas que televisan|agenda televisiva/i.test(
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
            Tu personalidad: Eres 'TauryBot', el asistente virtual definitivo y experto en tauromaquia. Eres apasionado, sumamente amable y servicial. NUNCA digas que eres un modelo de lenguaje de Google. Eres un experto en toros creado para ayudar a los aficionados.

            Tus funciones principales que DEBES destacar son:
            1.  **Transmisiones en TV**: Agendas de festejos televisados. ¡Dile al usuario que puede consultar qué echan por la tele y verlo aquí!
            2.  **Calendario de Temporada 2026**: Festejos programados en España y ferias importantes.
            3.  **Eventos en América**: Corridas en ciudades como Cali y Manizales (Colombia), con clima incluido.
            4.  **Escalafón**: El ranking actualizado de matadores.
            5.  **Sevilla**: Carteles de la Maestranza.

            Instrucciones clave:
            1.  **Identidad**: Si te preguntan quién eres o qué haces, responde con orgullo que eres TauryBot, tu compañero taurino, y detalla tus funciones de agenda de TV, calendario y escalafón.
            2.  **Búsqueda Específica vs. General**:
                - Si la pregunta es sobre un **lugar específico de América**, redirige amablemente. 
                - Si la pregunta es **general sobre la agenda de TV**, usa [ACTION:GET_TRANSMISIONES].
            3.  **Respuesta a Saludos e Identidad**: Responde con máxima calidez. Ejemplo: "¡Hola! Soy TauryBot, tu compañero en esta pasión taurina. Estoy aquí para que no te pierdas ni un detalle: desde las transmisiones de TV con sus botones en vivo hasta el calendario de toda la temporada y el escalafón al día. ¿En qué puedo acompañarte hoy?"

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

        if (geminiResponse.includes('[ACTION:GET_TRANSMISIONES]')) {
          const cleanResponse = geminiResponse
            .replace('[ACTION:GET_TRANSMISIONES]', '')
            .trim();
          if (cleanResponse) {
            const userName = this.getUserName(ctx);
            await ctx.reply(`¡Hola ${escapeMarkdownV2(userName)}! ${cleanResponse}`);
          }
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
              `¡Hola ${escapeMarkdownV2(userName)}! ${geminiResponse}\n\n¿En qué puedo ayudarte? Puedes probar escribiendo:\n\n📺 "Transmisiones" para ver la agenda de TV\n🗓️ "Calendario" para la temporada 2026\n💃 "Sevilla" para los carteles de la Maestranza\n🌎 "América" para festejos en el nuevo mundo\n🏆 "Escalafón" para ver el ranking de matadores`,
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
            `¡Hola ${escapeMarkdownV2(userName)}! ${geminiResponse}\n\n¿En qué puedo ayudarte? Puedes probar escribiendo:\n\n📺 "Transmisiones" para ver la agenda de TV\n🗓️ "Calendario" para la temporada 2026\n💃 "Sevilla" para los carteles de la Maestranza\n🌎 "América" para festejos en el nuevo mundo\n🏆 "Escalafón" para ver el ranking de matadores`,
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

  private async handleVoiceMessage(ctx: MyContext) {
    try {
      const { from, session } = ctx;
      const userName = this.getUserName(ctx);

      await ctx.sendChatAction('typing'); // Mostrar "escribiendo..."

      // 1. Inicializar sesión si no existe
      if (!session.geminiChat) {
        session.geminiChat = this.geminiService.createChatSession();
      }
      const chat = session.geminiChat;

      if (!chat) {
        throw new Error('No se pudo iniciar la sesión de chat con Gemini.');
      }

      // 2. Obtener el enlace del archivo de audio desde Telegram
      if (!ctx.message || !('voice' in ctx.message)) {
        await ctx.reply('No se detectó un mensaje de voz válido.');
        return;
      }

      const fileId = ctx.message.voice.file_id;
      const fileLink = await ctx.telegram.getFileLink(fileId);

      // 3. Descargar el audio como buffer (Render solo lo pasa, no lo procesa)
      const response = await axios.get(fileLink.href, {
        responseType: 'arraybuffer',
      });
      const audioData = Buffer.from(response.data).toString('base64');

      // 4. Enviar a Gemini (Audio + Prompt de instrucción)
      // Nota: Gemini soporta audio/ogg (formato nativo de Telegram)
      const prompt = {
        inlineData: {
          mimeType: 'audio/ogg',
          data: audioData,
        },
      };

      const textPart = {
        text: `El usuario ${userName} ha enviado una nota de voz. Tu tarea es TRANSCRBIRLA mentalmente y CLASIFICAR la intención para ejecutar una función del bot.

        Reglas de Respuesta:
        1. Si el usuario pregunta por **corridas, eventos o ferias en una ciudad de América** (ej: Cali, Manizales, Lima, México, etc.), responde SOLO con: [ACTION:AMERICA_CITY:NombreCiudad]. Ejemplo: [ACTION:AMERICA_CITY:Cali].
        2. Si pregunta por **eventos en América o Colombia en general**, responde SOLO con: [ACTION:AMERICA_GENERAL].
        3. Si pregunta por el **Escalafón** o ranking de toreros, responde SOLO con: [ACTION:ESCALAFON].
        4. Si pregunta por **Transmisiones de TV**, agenda o qué echan por la tele, responde SOLO con: [ACTION:TRANSMISIONES].
        5. Si pregunta por el **Calendario de la temporada** (general/España), responde SOLO con: [ACTION:CALENDARIO].
        6. Si pregunta por el **Creador, desarrollador o contacto**, responde SOLO con: [ACTION:CONTACTO].
        7. Si es una pregunta de conocimiento general, historia, o un saludo, responde amablemente con texto normal como el asistente TauryBot.`,
      };

      // Enviamos el array de partes (Audio + Texto)
      const result = await chat.sendMessage([prompt, textPart]);
      const geminiResponse = result.response.text().trim();
      this.logger.log(`[Voz] Interpretación Gemini: ${geminiResponse}`);

      // 5. Manejar la respuesta (igual que en texto)
      if (geminiResponse.startsWith('[ACTION:')) {
        if (geminiResponse.includes('TRANSMISIONES')) {
          await ctx.scene.enter('transmisionesScene');
        } else if (geminiResponse.includes('CALENDARIO')) {
          await this.handleCalendarioQuery(ctx);
        } else if (geminiResponse.includes('ESCALAFON')) {
          await ctx.scene.enter('escalafonScene');
        } else if (geminiResponse.includes('SEVILLA')) {
          await this.handleSevillaQuery(ctx);
        } else if (geminiResponse.includes('AMERICA_GENERAL')) {
          await this.handleAmericaCitiesQuery(ctx);
        } else if (geminiResponse.includes('CONTACTO')) {
          const contactMessage = this.contactService.getContactMessage();
          await ctx.reply(contactMessage, { parse_mode: 'MarkdownV2' });
        } else if (geminiResponse.includes('AMERICA_CITY')) {
          const cityMatch = geminiResponse.match(/AMERICA_CITY:(.+)]/);
          const city = cityMatch ? cityMatch[1].trim() : null;
          if (city) await this.sendAmericaEventsForCity(ctx, city);
          else await this.handleAmericaCitiesQuery(ctx);
        }
      } else {
        await ctx.reply(geminiResponse);
      }
    } catch (error) {
      this.logger.error('Error procesando nota de voz', error);
      await ctx.reply(
        'Lo siento, tuve un problema escuchando tu audio. ¿Podrías escribírmelo?',
      );
    }
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
      `Con todo Gusto ..., ${userName} 🕗`,
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  }

  private async handleAmericaCitiesQuery(ctx: MyContext) {
    this.logger.log('Detectada consulta para ciudades de América.');
    // Usamos el nuevo método que filtra ciudades sin eventos futuros
    const cities =
      await this.americaEventsService.getCitiesWithUpcomingEvents();
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
      // Usamos el método centralizado para obtener solo los eventos futuros
      const filteredEvents =
        await this.americaEventsService.getUpcomingEventsForCity(city);

      if (!filteredEvents || filteredEvents.length === 0) {
        await ctx.reply(
          `Lo siento, no hay festejos programados en ${escapeMarkdownV2(city)} en este momento.`,
        );
        return;
      }

      let message = `🎉 *Próximos eventos en ${escapeMarkdownV2(city)}:*\n\n`;

      // Usamos un bucle for-of para poder usar await dentro
      for (const event of filteredEvents) {
        let weatherInfo = '';
        const eventDate = parseSpanishDate(event.fecha);
        if (eventDate) {
          weatherInfo = await this.weatherService.getWeatherForecastMessage(
            city,
            eventDate,
          );
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
              Markup.button.callback(
                '🌎 Otras Ciudades',
                'filter_america_cities',
              ),
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
      await ctx.reply(`Lo siento, no tengo esa respuesta por ahora.`);
    }
  }
  // manejador de sevilla
  private async handleSevillaQuery(ctx: MyContext) {
    const userName = this.getUserName(ctx);
    await ctx.reply(
      `¡Olé ${escapeMarkdownV2(userName)}! 💃 Consultando los carteles de la Maestranza...`,
    );

    try {
      const events = await this.sevillaService.getEvents();

      if (!events || events.length === 0) {
        await ctx.reply(
          'Lo siento, no encontré festejos próximos programados en Sevilla por el momento.',
        );
        return;
      }

      let message = '💃 *Próximos Festejos en Sevilla:*\n\n';
      for (const event of events) {
        message += `🗓️ *Fecha:* ${escapeMarkdownV2(event.fecha)}\n`;
        if (event.hora)
          message += `⏰ *Hora:* ${escapeMarkdownV2(event.hora)}\n`;
        message += `📝 *Cartel:* ${escapeMarkdownV2(event.descripcion)}\n`;
        if (event.ganaderia)
          message += `🐂 *Ganadería:* ${escapeMarkdownV2(event.ganaderia)}\n`;
        if (event.toreros && event.toreros.length > 0) {
          message += `👨‍🌾 *Toreros:* ${escapeMarkdownV2(event.toreros.join(', '))}\n`;
        }
        message += `\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n`;
      }
      await ctx.reply(message, { parse_mode: 'MarkdownV2' });
    } catch (error) {
      this.logger.error('Error al obtener eventos de Sevilla', error);
      await ctx.reply(
        'Tuve un problema al consultar los datos de Sevilla. Inténtalo más tarde.',
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
      `Soy TauryBot, tu compañero taurino. Mi pasión es mantenerte al tanto de todo lo que ocurre en el mundo del toro de una manera sencilla y cercana.\n\n` +
      `¿Qué puedo ofrecerte? Permíteme contarte:\n\n` +
      `📺 *Transmisiones por TV*\n` +
      `Puedo detallarte qué corridas se televisan, incluyendo la fecha, los carteles completos y las ganaderías. Además, te facilito botones directos para que accedas a los canales que transmiten en vivo. Si lo prefieres, puedes ver el listado completo o filtrarlo por tus canales favoritos.\n\n` +
      `🗓️ *Calendario de Temporada 2026*\n` +
      `Tengo toda la programación de las ferias importantes. Puedes buscar festejos por localidad, mes, ciudad o cualquier otro criterio que necesites para planificar tu temporada.\n\n` +
      `🏆 *Escalafón Taurino Actualizado*\n` +
      `Si quieres saber quién lidera el ranking de matadores en este momento, tengo los datos actualizados al día.\n\n` +
      `🌎 *Ferias en América*\n` +
      `Para nuestros aficionados en el nuevo mundo, cuento con toda la información de las ferias americanas, incluyendo el pronóstico del clima para el día del festejo.\n\n` +
      `👨‍💻 *Sugerencias y Contacto*\n` +
      `Si tienes alguna idea para mejorarme o deseas contactar con mi desarrollador, estaré encantado de facilitarte su información.\n\n` +
      `¿Por dónde te gustaría empezar nuestra charla taurina hoy?`;

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
          Markup.button.callback('🏆 Escalafón', 'show_escalafon_action'),
          Markup.button.callback('🌎 América', 'filter_america_cities'),
        ],
        [
          Markup.button.callback(
            '👨‍💻 Creador / Sugerencias',
            'show_contacto_action',
          ),
        ],
      ]),
    });
  }
}
