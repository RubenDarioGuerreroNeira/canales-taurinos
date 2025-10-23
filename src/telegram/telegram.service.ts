import {
  Injectable,
  OnModuleInit,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Telegraf, Markup, session, Scenes } from 'telegraf';
import {
  ChatSession,
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from '@google/generative-ai';
import { ScraperService } from '../scraper/scraper.service';
import { ServitoroService, ServitoroEvent } from '../scraper/servitoro.service';
import pTimeout from 'p-timeout';
import { ContactService } from '../contact/contact.service';

// 1. Definir la estructura de los datos de la escena
interface MySceneSession extends Scenes.SceneSessionData {
  filterState?: 'awaiting_month' | 'awaiting_channel';
  filterStateCal?:
    | 'awaiting_month_cal'
    | 'awaiting_city_cal'
    | 'awaiting_location_cal'
    | 'awaiting_free_text_cal';
  servitoroEvents?: ServitoroEvent[];
  currentCalFilter?: {
    type: 'month' | 'city' | 'location' | 'free';
    value: string;
  };
  currentCalPage?: number;
}

interface MySession extends Scenes.SceneSession<MySceneSession> {
  geminiChat?: ChatSession;
}

interface MyContext extends Scenes.SceneContext<MySceneSession> {
  session: MySession;
}

@Injectable()
export class TelegramService implements OnModuleInit, OnApplicationBootstrap {
  private bot: Telegraf<MyContext>;
  private readonly logger = new Logger(TelegramService.name);
  private genAI: GoogleGenerativeAI;

  constructor(
    private scraperService: ScraperService,
    private servitoroService: ServitoroService,
    private contactService: ContactService,
  ) {
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

    this.bot = new Telegraf<MyContext>(token);

    const stage = new Scenes.Stage<MyContext>([
      this.createTransmisionesScene(),
      this.createCalendarioScene(),
    ]);

    this.bot.use(session(), stage.middleware());
    this.genAI = new GoogleGenerativeAI(geminiApiKey);
  }

  onModuleInit() {
    this.setupCommands();
    console.log('Servicio de Telegram inicializado y comandos configurados.');
  }

  onApplicationBootstrap() {
    this.bot.launch();
    console.log('🤖 Bot de Telegram iniciado con long polling...');
  }

  getBot(): Telegraf<MyContext> {
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
          const mensaje = `🗓 *${this.escapeMarkdownV2(ev.fecha)}*\n_${this.escapeMarkdownV2(ev.descripcion)}_`;
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
          '📌 Fuente: www.elmuletazo.com. ¡Suerte para todos!\n\n¿Hay algo más en lo que pueda ayudarte?',
        );
      } catch (err) {
        console.error('Error en /transmisiones:', err.message);
        await ctx.reply(
          '❌ Error al obtener las transmisiones. Inténtalo más tarde.',
        );
      }
    };

    this.bot.command('transmisiones', (ctx) =>
      ctx.scene.enter('transmisionesScene'),
    );
    this.bot.command('filtrar', (ctx) => ctx.scene.enter('transmisionesScene'));

    this.bot.command('clearcache', async (ctx) => {
      this.scraperService.clearCache();
      console.log('TelegramService: La caché del scraper ha sido limpiada.');
      await ctx.reply(
        '🧹 La caché de transmisiones ha sido limpiada. ¡Intenta tu búsqueda de nuevo!',
      );
    });

    this.bot.command('clearcache_servitoro', async (ctx) => {
      this.servitoroService.clearCache();
      console.log('TelegramService: La caché de Servitoro ha sido limpiada.');
      await ctx.reply(
        '🧹 La caché del calendario de Servitoro ha sido limpiada. ¡Intenta tu búsqueda de nuevo!',
      );
    });

    this.bot.command('calendario', async (ctx) => {
      await ctx.reply('📡 Consultando el calendario taurino de Servitoro...');
      try {
        // Envolvemos la llamada al scraper en un timeout de 85 segundos.
        // Esto es un poco menos que el timeout de Telegraf (90s) para poder responder al usuario.
        const eventos = await pTimeout(
          this.servitoroService.getCalendarioTaurino(),
          85000, // El segundo argumento es el número de milisegundos
        );

        if (!eventos || eventos.length === 0) {
          await ctx.reply(
            '😕 No se encontraron eventos en el calendario en este momento.',
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
          '⏳ La consulta está tardando más de lo esperado. Por favor, inténtalo de nuevo en un par de minutos. Es posible que la información ya esté disponible.',
        );
      }
    });

    this.bot.command('contacto', async (ctx) => {
      const contactMessage = this.contactService.getContactMessage();
      await ctx.reply(contactMessage, { parse_mode: 'MarkdownV2' });
    });

    this.bot.start((ctx) => {
      ctx.session = {};
      const userName = ctx.from.first_name || 'aficionado';
      const greeting = this.getGreeting(userName);

      const welcomeOptions = [
        'Soy tu asistente taurino. Puedes usar /transmisiones o preguntarme sobre la "agenda de toros". Si tienes sugerencias, usa /contacto.',
        'Estoy a tu disposición. Para ver las corridas, usa /transmisiones o escribe "dame las fechas". ¡Tu feedback es bienvenido con /contacto!',
        '¿Listo para la faena? Usa /transmisiones o pregúntame: "¿qué corridas televisan?". Para sugerencias, estoy en /contacto.',
        '¡Qué alegría verte! Pregúntame por la "agenda de festejos". Si quieres ayudar a mejorarme, ¡usa el comando /contacto!',
      ];

      const randomWelcome =
        welcomeOptions[Math.floor(Math.random() * welcomeOptions.length)];
      const welcomeMessage = `${greeting}\n\n${randomWelcome}`;
      ctx.reply(welcomeMessage);
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
        const contactMessage = this.contactService.getContactMessage();
        await ctx.reply(contactMessage, { parse_mode: 'MarkdownV2' });
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
          const model = this.genAI.getGenerativeModel({
            model: 'gemini-2.0-flash',
            safetySettings: [
              {
                category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
              },
            ],
          });
          ctx.session.geminiChat = model.startChat({
            history: [],
            generationConfig: { maxOutputTokens: 1000 },
          });
        }

        const chat = session.geminiChat;
        if (!chat) {
          console.error('La sesión de chat no se pudo inicializar.');
          await ctx.reply(
            'Hubo un problema al iniciar la conversación. Por favor, intenta de nuevo.',
          );
          return;
        }

        let prompt = userText;
        const isAgendaQuery =
          /cartel|fecha|corrida|canal|agenda|transmisionfestejo|transmisi|toros/i.test(
            userText,
          );

        if (isAgendaQuery) {
          await ctx.reply(this.getRandomThinkingMessage());
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

            3.  **Respuesta a Saludos**: Si el usuario solo saluda (ej: "Hola", "Buenas"), responde de forma cordial y recuérdale que puede usar '/transmisiones'.
 
            4.  **Sin Resultados**: Si después de buscar no encuentras información para un lugar específico, responde amablemente: "Lo siento, aún no dispongo de información sobre festejos en esa localidad. Vuelve a consultarme más adelante."

            5.  **Otras Preguntas**: Para preguntas generales sobre tauromaquia (historia, toreros, etc.), responde de forma cordial y precisa.

            ${scraperContext}

            Conversación actual:
            Usuario: "${userText}"
            Tu respuesta:
          `;
        }

        if (!isAgendaQuery) {
          await ctx.reply(this.getRandomThinkingMessage());
        }

        let result = await chat.sendMessage(prompt);
        let geminiResponse = result.response.text().trim();
        console.log(`[Respuesta de Gemini 1] ${geminiResponse}`);

        if (geminiResponse === '[ACTION:GET_TRANSMISIONES]') {
          await ctx.scene.enter('transmisionesScene');
        } else if (geminiResponse.toLowerCase().includes('voy a buscar')) {
          await ctx.reply(geminiResponse);
          result = await chat.sendMessage(
            'Ok, por favor, dame los resultados que encontraste.',
          );
          geminiResponse = result.response.text().trim();
          console.log(`[Respuesta de Gemini 2] ${geminiResponse}`);
          await ctx.reply(
            `${geminiResponse}\n\n¿Hay algo más en lo que pueda ayudarte? (Recuerda que puedes pedir la "agenda de toros" cuando quieras).`,
          );
        } else {
          await ctx.reply(
            `${geminiResponse}\n\n¿Hay algo más en lo que pueda ayudarte? (Recuerda que puedes pedir la "agenda de toros" cuando quieras).`,
          );
        }
      } catch (error) {
        console.error('Error al contactar con Gemini:', error);
        if (ctx.session) ctx.session.geminiChat = undefined;
        await ctx.reply(
          'Lo siento, estoy teniendo problemas para conectar con mi inteligencia. Por favor, intenta usar el comando /transmisiones directamente o reinicia la conversación con /start.',
        );
      }
    });
  }

  private createTransmisionesScene(): Scenes.BaseScene<MyContext> {
    const scene = new Scenes.BaseScene<MyContext>('transmisionesScene');

    const showFilteredEvents = async (ctx, filterFn) => {
      await ctx.reply('Buscando transmisiones...');
      const allEvents = await this.scraperService.scrapeTransmisiones();
      const events = allEvents.filter(filterFn);

      if (!events.length) {
        await ctx.reply('⚠️ No se encontraron transmisiones con ese filtro.');
        return;
      }

      for (const ev of events.slice(0, 10)) {
        const mensaje = `🗓 *${this.escapeMarkdownV2(ev.fecha)}*\n_${this.escapeMarkdownV2(ev.descripcion)}_`;
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
      await ctx.reply('📌 Fuente: www.elmuletazo.com');
    };

    scene.enter(async (ctx) => {
      await ctx.reply(
        '¿Puedes Filtrar las Transmisiones de las corridas ?',
        Markup.inlineKeyboard([
          [Markup.button.callback('📅 Ver Todas', 'ver_todas')],
          [
            Markup.button.callback('🗓️ Por Mes', 'filtrar_mes'),
            Markup.button.callback('📺 Por Canal', 'filtrar_canal'),
          ],
        ]),
      );
    });

    scene.action('ver_todas', async (ctx) => {
      await ctx.answerCbQuery();
      await showFilteredEvents(ctx, () => true);
      await ctx.scene.leave();
    });

    scene.action('filtrar_mes', async (ctx) => {
      ctx.scene.session.filterState = 'awaiting_month';
      await ctx.answerCbQuery();
      await ctx.reply(
        'Por favor, escribe el nombre del mes que te interesa (ej: "Octubre").',
      );
    });

    scene.action('filtrar_canal', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply('Consultando canales disponibles...');
      const allEvents = await this.scraperService.scrapeTransmisiones();
      const channels = [
        ...new Set(
          allEvents.flatMap((ev) =>
            ev.enlaces.map((link) => this.getChannelNameFromUrl(link.url, 0)),
          ),
        ),
      ];

      if (channels.length === 0) {
        await ctx.reply(
          'No hay canales con transmisiones programadas ahora mismo.',
        );
        return ctx.scene.leave();
      }

      const buttons = channels.map((channel) =>
        Markup.button.callback(channel, `canal_${channel}`),
      );
      await ctx.reply(
        'Selecciona un canal:',
        Markup.inlineKeyboard(buttons, { columns: 2 }),
      );
    });

    scene.action(/canal_(.+)/, async (ctx) => {
      const channel = ctx.match[1];
      await ctx.answerCbQuery();
      await showFilteredEvents(ctx, (ev) =>
        ev.enlaces.some(
          (link) => this.getChannelNameFromUrl(link.url, 0) === channel,
        ),
      );
      await ctx.scene.leave();
    });

    scene.on('text', async (ctx) => {
      if (ctx.scene.session.filterState === 'awaiting_month') {
        const month = ctx.message.text.toLowerCase();
        await showFilteredEvents(ctx, (ev) =>
          ev.fecha.toLowerCase().includes(month),
        );
        await ctx.scene.leave();
      }
    });

    return scene;
  }

  private createCalendarioScene(): Scenes.BaseScene<MyContext> {
    const scene = new Scenes.BaseScene<MyContext>('calendarioScene');
    const EVENTS_PER_PAGE = 3;

    const showFilteredCalendarioEvents = async (
      ctx: MyContext,
      filterCriteria: {
        type: 'month' | 'city' | 'location' | 'free';
        value: string;
      },
      page: number = 0,
    ) => {
      const allEvents = ctx.scene.session.servitoroEvents || [];
      let filteredEvents: ServitoroEvent[] = [];

      if (filterCriteria.type === 'month') {
        filteredEvents = allEvents.filter((e) => {
          const eventMonth = this.getMonthNameFromDateString(e.fecha);
          return (
            eventMonth &&
            eventMonth.toLowerCase() === filterCriteria.value.toLowerCase()
          );
        });
      } else if (filterCriteria.type === 'city') {
        filteredEvents = allEvents.filter((e) =>
          e.ciudad.toLowerCase().includes(filterCriteria.value.toLowerCase()),
        );
      } else if (filterCriteria.type === 'location') {
        filteredEvents = allEvents.filter((e) =>
          e.location.toLowerCase().includes(filterCriteria.value.toLowerCase()),
        );
      } else if (filterCriteria.type === 'free') {
        const searchValue = filterCriteria.value.toLowerCase();
        filteredEvents = allEvents.filter(
          (e) =>
            e.fecha.toLowerCase().includes(searchValue) ||
            e.ciudad.toLowerCase().includes(searchValue) ||
            e.nombreEvento.toLowerCase().includes(searchValue) ||
            e.categoria.toLowerCase().includes(searchValue) ||
            e.location.toLowerCase().includes(searchValue),
        );
      } else {
        filteredEvents = allEvents;
      }

      if (filteredEvents.length === 0) {
        await ctx.reply('😕 No se encontraron eventos con esos criterios.');
        ctx.scene.leave();
        return;
      }

      const totalPages = Math.ceil(filteredEvents.length / EVENTS_PER_PAGE);
      const start = page * EVENTS_PER_PAGE;
      const end = start + EVENTS_PER_PAGE;
      const eventsToShow = filteredEvents.slice(start, end);

      if (eventsToShow.length === 0 && page > 0) {
        await ctx.reply('No hay más eventos para mostrar.');
        ctx.scene.leave();
        return;
      } else if (eventsToShow.length === 0) {
        await ctx.reply('😕 No se encontraron eventos con esos criterios.');
        ctx.scene.leave();
        return;
      }

      const mensajes = eventsToShow.map((e) => {
        const fecha = this.escapeMarkdownV2(e.fecha);
        const ciudad = this.escapeMarkdownV2(e.ciudad);
        const nombreEvento = this.escapeMarkdownV2(e.nombreEvento);
        const categoria = this.escapeMarkdownV2(e.categoria);
        const location = this.escapeMarkdownV2(e.location);
        const link = e.link
          ? `\n[🔗 Ver entradas](${this.escapeMarkdownUrl(e.link)})`
          : '';

        return `📅 *${fecha}* \\- ${ciudad}\n*${nombreEvento}*\n_${categoria}_\n📍 ${location}${link}`;
      });

      const headerText = `Resultados (${start + 1}-${Math.min(end, filteredEvents.length)} de ${filteredEvents.length}):`;
      const messageHeader = `${this.escapeMarkdownV2(headerText)}\n\n`;
      const messageFooter = `\n\n📌 Fuente: www\\.servitoro\\.com`;
      const messageBody = mensajes.join('\n\n\\-\\-\\-\\-\\-\\-\n\n');
      const finalMessage = `${messageHeader}${messageBody}${messageFooter}`;

      const buttons: any[] = [];
      if (page < totalPages - 1) {
        buttons.push(Markup.button.callback('➡️ Siguiente', 'next_page_cal'));
      }
      buttons.push(Markup.button.callback('❌ Salir', 'exit_cal'));

      await ctx.reply(finalMessage, {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard(buttons),
      });

      ctx.scene.session.currentCalFilter = filterCriteria;
      ctx.scene.session.currentCalPage = page;
    };

    scene.enter(async (ctx) => {
      const totalEvents = ctx.scene.session.servitoroEvents?.length || 0;
      await ctx.reply(
        `Hemos encontrado ${totalEvents} eventos taurinos. ¿Cómo te gustaría filtrarlos?`,
        Markup.inlineKeyboard([
          [Markup.button.callback('📅 Por Mes', 'filter_month_cal')],
          [Markup.button.callback('🏙️ Por Ciudad', 'filter_city_cal')],
          [Markup.button.callback('📍 Por Localidad', 'filter_location_cal')],
          [Markup.button.callback('🔍 Búsqueda Libre', 'filter_free_cal')],
          [Markup.button.callback('❌ Salir', 'exit_cal')],
        ]),
      );
    });

    scene.action('filter_month_cal', async (ctx) => {
      await ctx.answerCbQuery();
      const allEvents = ctx.scene.session.servitoroEvents || [];
      const uniqueMonths = [
        ...new Set(
          allEvents
            .map((e) => this.getMonthNameFromDateString(e.fecha))
            .filter((m): m is string => m !== null),
        ),
      ];

      const monthList = uniqueMonths
        .map((m) => `\`${this.escapeMarkdownV2(m)}\``)
        .join(', ');
      ctx.scene.session.filterStateCal = 'awaiting_month_cal';
      await ctx.reply(
        `Por favor, escribe el nombre del mes\\. Meses disponibles: ${monthList}`,
        {
          parse_mode: 'MarkdownV2',
        },
      );
    });

    scene.action('filter_city_cal', async (ctx) => {
      ctx.scene.session.filterStateCal = 'awaiting_city_cal';
      await ctx.answerCbQuery();
      await ctx.reply(
        'Por favor, escribe el nombre de la ciudad (ej: "Sevilla").',
      );
    });

    scene.action('filter_location_cal', async (ctx) => {
      ctx.scene.session.filterStateCal = 'awaiting_location_cal';
      await ctx.answerCbQuery();
      await ctx.reply('Por favor, escribe la localidad (ej: "Las Ventas").');
    });

    scene.action('filter_free_cal', async (ctx) => {
      ctx.scene.session.filterStateCal = 'awaiting_free_text_cal';
      await ctx.answerCbQuery();
      await ctx.reply('Escribe tu búsqueda (ej: "Madrid en Octubre").');
    });

    scene.action('next_page_cal', async (ctx) => {
      await ctx.answerCbQuery();
      const currentPage = ctx.scene.session.currentCalPage || 0;
      const filter = ctx.scene.session.currentCalFilter;
      if (filter) {
        await showFilteredCalendarioEvents(ctx, filter, currentPage + 1);
      } else {
        await ctx.reply(
          'Error: No se encontró el filtro actual para la paginación.',
        );
        ctx.scene.leave();
      }
    });

    scene.action('exit_cal', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.reply(
        '¡De acuerdo! Puedes volver a consultar el calendario cuando quieras.',
      );
      ctx.scene.leave();
    });

    scene.on('text', async (ctx) => {
      const filterState = ctx.scene.session.filterStateCal;
      const userText = ctx.message.text.trim();

      if (filterState === 'awaiting_month_cal') {
        await showFilteredCalendarioEvents(ctx, {
          type: 'month',
          value: userText,
        });
      } else if (filterState === 'awaiting_city_cal') {
        await showFilteredCalendarioEvents(ctx, {
          type: 'city',
          value: userText,
        });
      } else if (filterState === 'awaiting_location_cal') {
        await showFilteredCalendarioEvents(ctx, {
          type: 'location',
          value: userText,
        });
      } else if (filterState === 'awaiting_free_text_cal') {
        await showFilteredCalendarioEvents(ctx, {
          type: 'free',
          value: userText,
        });
      } else {
        await ctx.reply(
          'No entiendo tu respuesta. Por favor, usa los botones o sal de la búsqueda.',
        );
      }
    });

    return scene;
  }

  private escapeMarkdownV2(text: string): string {
    if (!text) return '';
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }

  private escapeMarkdownUrl(url: string): string {
    if (!url) return '';
    return url.replace(/[()\\]/g, '\\$&');
  }

  private getMonthNameFromDateString(dateString: string): string | null {
    if (!dateString) return null;

    const monthMatch = dateString.match(/\d{1,2} (\w+) \d{4}/i);
    if (monthMatch && monthMatch[1]) {
      return (
        monthMatch[1].charAt(0).toUpperCase() +
        monthMatch[1].slice(1).toLowerCase()
      );
    }

    const slashDateMatch = dateString.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slashDateMatch && slashDateMatch[2]) {
      const monthIndex = parseInt(slashDateMatch[2], 10) - 1;
      if (monthIndex >= 0 && monthIndex < 12) {
        const date = new Date(2000, monthIndex, 1);
        return date.toLocaleDateString('es-ES', { month: 'long' });
      }
    }

    return null;
  }

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
