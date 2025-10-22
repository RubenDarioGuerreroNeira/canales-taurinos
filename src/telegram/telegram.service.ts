import {
  Injectable,
  OnModuleInit,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Telegraf, Markup, session, Context, Scenes } from 'telegraf';
import {
  ChatSession,
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from '@google/generative-ai';
import { ScraperService } from '../scraper/scraper.service';
import { Update } from 'telegraf/types';
import { ContactService } from '../contact/contact.service';

// 1. Definir la estructura de los datos de la escena
interface MySceneSession extends Scenes.SceneSessionData {
  filterState?: 'awaiting_month' | 'awaiting_channel'; // Estado específico de la escena
}

// 2. Definir la sesión principal que incluye datos personalizados y de escenas
interface MySession extends Scenes.SceneSession<MySceneSession> {
  geminiChat?: ChatSession;
}

// 3. Definir el contexto personalizado que usa nuestra sesión y sabe de escenas.
//    Extiende Scenes.SceneContext con los datos de la escena y luego sobrescribe 'session'
//    para incluir nuestras propiedades personalizadas.
interface MyContext extends Scenes.SceneContext<MySceneSession> {
  session: MySession;
}

@Injectable()
export class TelegramService implements OnModuleInit, OnApplicationBootstrap {
  // 3. Usar nuestro contexto personalizado
  private bot: Telegraf<MyContext>;
  private genAI: GoogleGenerativeAI;

  constructor(
    private scraperService: ScraperService,
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

    // 4. Pasar el tipo de contexto al crear la instancia de Telegraf
    this.bot = new Telegraf<MyContext>(token);

    // Crear la escena y el gestor de escenas (Stage)
    const stage = new Scenes.Stage<MyContext>([
      this.createTransmisionesScene(),
    ]);

    // Habilitar sesiones para mantener el contexto de la conversación por usuario.
    this.bot.use(session(), stage.middleware());

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

    this.bot.command('contacto', async (ctx) => {
      const contactMessage = this.contactService.getContactMessage();
      // Usamos replyWithMarkdownV2 para que los enlaces de WhatsApp funcionen
      await ctx.reply(contactMessage, { parse_mode: 'MarkdownV2' });
    });

    this.bot.start((ctx) => {
      // Limpiar la sesión al iniciar para forzar un nuevo contexto de chat.
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

    // Middleware para manejar todos los mensajes de texto que no son comandos
    this.bot.on('text', async (ctx) => {
      const userText = ctx.message.text.trim();

      // Ignorar si es un comando, ya que tienen su propio manejador
      if (userText.startsWith('/')) {
        return;
      }

      // Lógica para detectar preguntas sobre contacto/autoría antes de ir a Gemini
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
        // Detenemos el procesamiento para no enviar la consulta a Gemini
        return;
      }

      try {
        // 1. Asegurarse de que la sesión exista
        if (!ctx.session) {
          ctx.session = {};
        }

        // 2. Ahora que es seguro, desestructuramos
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
          // Esto no debería ocurrir por la lógica anterior, pero es una guarda de seguridad.
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

        // Si es una consulta de agenda, enriquecemos el prompt con el contexto del scraper.
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

            2.  **Validación de Fechas**: Siempre que des una fecha, asegúrate de que sea posterior a la fecha actual (${new Date().toLocaleDateString(
              'es-ES',
            )}). Descarta eventos pasados.

            3.  **Respuesta a Saludos**: Si el usuario solo saluda (ej: "Hola", "Buenas"), responde de forma cordial y recuérdale que puede usar '/transmisiones'.
 
            4.  **Sin Resultados**: Si después de buscar no encuentras información para un lugar específico, responde amablemente: "Lo siento, aún no dispongo de información sobre festejos en esa localidad. Vuelve a consultarme más adelante."

            5.  **Otras Preguntas**: Para preguntas generales sobre tauromaquia (historia, toreros, etc.), responde de forma cordial y precisa.

            ${scraperContext}

            Conversación actual:
            Usuario: "${userText}"
            Tu respuesta:
          `;
        }

        // Si no es una consulta de agenda, no necesitamos el pre-reply de "pensando"
        if (!isAgendaQuery) {
          await ctx.reply(this.getRandomThinkingMessage());
        }

        let result = await chat.sendMessage(prompt);
        let geminiResponse = result.response.text().trim();
        console.log(`[Respuesta de Gemini 1] ${geminiResponse}`);

        if (geminiResponse === '[ACTION:GET_TRANSMISIONES]') {
          await ctx.scene.enter('transmisionesScene');
        } else if (geminiResponse.toLowerCase().includes('voy a buscar')) {
          await ctx.reply(geminiResponse); // Notificamos al usuario "Voy a buscar..."
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
        // Limpiar la sesión en caso de error para empezar de nuevo en el siguiente mensaje.
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
      await showFilteredEvents(ctx, () => true); // Sin filtro
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

    // Manejar la selección de un canal específico
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

    // Manejar la entrada de texto (para el mes)
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
