import { Injectable, Logger } from '@nestjs/common';
import { Scenes, Markup } from 'telegraf';
import { MyContext } from '../telegram.interfaces';
import { ServitoroEvent } from '../../scraper/servitoro.service';
import {
  escapeMarkdownV2,
  escapeMarkdownUrl,
  parseSpanishDate,
} from '../../utils/telegram-format';
import { WeatherService } from '../../weather/weather.service';
import { WeatherResult } from '../../weather/interfaces/weather.interface';
import { VentasService } from '../../scraper/ventas.service';
import { SevillaService } from '../../scraper/sevilla.service';

@Injectable()
export class CalendarioSceneService {
  private readonly logger = new Logger(CalendarioSceneService.name);
  private readonly EVENTS_PER_PAGE = 3;

  constructor(
    private readonly weatherService: WeatherService,
    private readonly ventasService: VentasService,
    private readonly sevillaService: SevillaService,
  ) { }

  create(): Scenes.BaseScene<MyContext> {
    const scene = new Scenes.BaseScene<MyContext>('calendarioScene');

    scene.enter(async (ctx) => {
      const userName = ctx.from?.first_name || 'aficionado';
      const totalEvents = ctx.scene.session.servitoroEvents?.length || 0;
      await ctx.reply(
        `¡Hola ${userName}! He Encontrado ${totalEvents} eventos taurinos. ¿Cómo te gustaría filtrar los?`,
        Markup.inlineKeyboard([
          [Markup.button.callback('📅 Por Mes', 'filter_month_cal')],
          [Markup.button.callback('🏙️ Por Ciudad', 'filter_city_cal')],
          [
            Markup.button.callback(
              '📍 Por Localidad',
              'filter_location_cal',
            ),
          ],
          [
            Markup.button.callback(
              '🔍 Búsqueda Libre',
              'filter_free_cal',
            ),
          ],
          [Markup.button.callback('❌ Salir', 'exit_cal')],
        ]),
      );
    });

    scene.action('filter_month_cal', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        this.logger.warn('Error al responder callback query: ' + e.message);
      }
      const userName = ctx.from?.first_name || 'aficionado';
      const allEvents = ctx.scene.session.servitoroEvents || [];
      const uniqueMonths = [
        ...new Set(
          allEvents
            .map((e) => this.getMonthNameFromDateString(e.fecha))
            .filter((m): m is string => m !== null),
        ),
      ];

      const monthList = uniqueMonths
        .map((m) => `\`${escapeMarkdownV2(m)}\``)
        .join(', ');
      ctx.scene.session.filterStateCal = 'awaiting_month_cal';
      await ctx.reply(
        `${escapeMarkdownV2(`¡Perfecto ${userName}! Por favor, escribe el nombre del mes. Meses disponibles:`)} ${monthList}`,
        {
          parse_mode: 'MarkdownV2',
        },
      );
    });

    scene.action('filter_city_cal', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        this.logger.warn('Error al responder callback query: ' + e.message);
      }
      ctx.scene.session.filterStateCal = 'awaiting_city_cal';
      const userName = ctx.from?.first_name || 'aficionado';
      await ctx.reply(
        `¡Entendido ${userName}! Por favor, escribe el nombre de la ciudad (ej: "Sevilla").`,
      );
    });

    scene.action('filter_location_cal', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        this.logger.warn('Error al responder callback query: ' + e.message);
      }
      ctx.scene.session.filterStateCal = 'awaiting_location_cal';
      const userName = ctx.from?.first_name || 'aficionado';
      await ctx.reply(
        `¡Claro ${userName}! Por favor, escribe la localidad (ej: "Las Ventas").`,
      );
    });

    scene.action('filter_free_cal', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        this.logger.warn('Error al responder callback query: ' + e.message);
      }
      ctx.scene.session.filterStateCal = 'awaiting_free_text_cal';
      const userName = ctx.from?.first_name || 'aficionado';
      await ctx.reply(
        `¡Adelante ${userName}! Escribe tu búsqueda (ej: "Madrid en Octubre").`,
      );
    });

    scene.action('next_page_cal', async (ctx) => {
      try {
        await ctx.answerCbQuery();
      } catch (e) {
        this.logger.warn('Error al responder callback query: ' + e.message);
      }
      const currentPage = ctx.scene.session.currentCalPage || 0;
      const filter = ctx.scene.session.currentCalFilter;
      if (filter) {
        await this.showFilteredCalendarioEvents(
          ctx,
          filter,
          currentPage + 1,
        );
      } else {
        const userName = ctx.from?.first_name || 'aficionado';
        await ctx.reply(
          `Lo siento ${userName}, hubo un error: No se encontró el filtro actual para la paginación.`,
        );
        ctx.scene.leave();
      }
    });

    scene.action('exit_cal', async (ctx) => {
      try {
        try {
          await ctx.answerCbQuery();
        } catch (e) {
          // Ignorar si ya expiró
        }
        ctx.scene.session.filterStateCal = undefined;
        const userName = ctx.from?.first_name || 'aficionado';
        await ctx.reply(
          `¡De acuerdo ${userName}! ¿En qué más puedo ayudarte?\n\nPuedes preguntar por la "tarnsmisiones de festejos que puedes ver aquí " o consultar el "calendario español taurino 2026" de nuevo cuando quieras, solo escribiendo "calendario".`,
        );
        await ctx.scene.leave();
      } catch (error) {
        this.logger.error(`Error in exit_cal action: ${error.message}`, error.stack);
      }
    });

    scene.on('text', async (ctx) => {
      try {
        const filterState = ctx.scene.session.filterStateCal;
        const userText = ctx.message.text.trim();

        if (filterState === 'awaiting_month_cal') {
          await this.showFilteredCalendarioEvents(ctx, {
            type: 'month',
            value: userText,
          });
          ctx.scene.session.filterStateCal = undefined;
        } else if (filterState === 'awaiting_city_cal') {
          await this.showFilteredCalendarioEvents(ctx, {
            type: 'city',
            value: userText,
          });
          ctx.scene.session.filterStateCal = undefined;
        } else if (filterState === 'awaiting_location_cal') {
          await this.showFilteredCalendarioEvents(ctx, {
            type: 'location',
            value: userText,
          });
          ctx.scene.session.filterStateCal = undefined;
        } else if (filterState === 'awaiting_free_text_cal') {
          await this.showFilteredCalendarioEvents(ctx, {
            type: 'free',
            value: userText,
          });
          ctx.scene.session.filterStateCal = undefined;
        }
      } catch (error) {
        this.logger.error(`Error in text handler: ${error.message}`, error.stack);
        await ctx.reply('Lo siento, ha ocurrido un error al procesar tu búsqueda.');
      }
    });

    return scene;
  }

  private async showFilteredCalendarioEvents(
    ctx: MyContext,
    filterCriteria: {
      type: 'month' | 'city' | 'location' | 'free';
      value: string;
    },
    page: number = 0,
  ) {
    const allEvents = ctx.scene.session.servitoroEvents || [];
    let filteredEvents: ServitoroEvent[] = [];

    const isMadridSearch =
      filterCriteria.value.toLowerCase().includes('madrid') ||
      filterCriteria.value.toLowerCase().includes('ventas');
    
    const isSevillaSearch =
      filterCriteria.value.toLowerCase().includes('sevilla') ||
      filterCriteria.value.toLowerCase().includes('maestranza');

    if (isMadridSearch || isSevillaSearch) {
      let specializedEvents: ServitoroEvent[] = [];
      
      if (isMadridSearch) {
        const madridEvents = await this.ventasService.getEvents();
        specializedEvents = madridEvents.map((ve) => ({
          fecha: `${ve.fecha}${ve.hora ? ` a las ${ve.hora}` : ''}`,
          ciudad: 'Madrid',
          nombreEvento: ve.descripcion || 'Corrida de toros',
          categoria: `Ganadería: ${ve.ganaderia || 'Varias'}\nToreros: ${ve.toreros.join(', ')}`,
          location: 'Plaza de Toros de Las Ventas',
          link: '', 
        }));
      } else if (isSevillaSearch) {
        const sevillaEvents = await this.sevillaService.getEvents();
        specializedEvents = sevillaEvents.map((se) => ({
          fecha: `${se.fecha}${se.hora ? ` a las ${se.hora}` : ''}`,
          ciudad: 'Sevilla',
          nombreEvento: se.descripcion || 'Corrida de toros',
          categoria: `Ganadería: ${se.ganaderia || 'Varias'}\nToreros: ${se.toreros.join(', ')}`,
          location: 'Plaza de Toros de la Maestranza',
          link: '', 
        }));
      }

      if (specializedEvents.length > 0) {
        if (filterCriteria.type === 'city') {
          filteredEvents = specializedEvents;
        } else {
          const otherEvents = allEvents.filter(
            (e) =>
              !e.ciudad.toLowerCase().includes('madrid') &&
              !e.location.toLowerCase().includes('ventas') &&
              !e.ciudad.toLowerCase().includes('sevilla') &&
              !e.location.toLowerCase().includes('maestranza'),
          );
          filteredEvents = [...specializedEvents, ...otherEvents];
        }

        // Re-filtrar por el criterio original
        if (filterCriteria.type === 'month') {
          filteredEvents = filteredEvents.filter((e) => {
            const eventMonth = this.getMonthNameFromDateString(e.fecha);
            return (
              eventMonth &&
              eventMonth.toLowerCase() ===
                filterCriteria.value.toLowerCase()
            );
          });
        } else if (filterCriteria.type === 'location') {
          filteredEvents = filteredEvents.filter((e) =>
            e.location
              .toLowerCase()
              .includes(filterCriteria.value.toLowerCase()),
          );
        } else if (filterCriteria.type === 'free') {
          const searchValue = filterCriteria.value.toLowerCase();
          filteredEvents = filteredEvents.filter(
            (e) =>
              e.fecha.toLowerCase().includes(searchValue) ||
              e.ciudad.toLowerCase().includes(searchValue) ||
              e.nombreEvento.toLowerCase().includes(searchValue) ||
              e.categoria.toLowerCase().includes(searchValue) ||
              e.location.toLowerCase().includes(searchValue),
          );
        }
      }
    } else {
      // Lógica general para otras ciudades
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
          e.ciudad
            .toLowerCase()
            .includes(filterCriteria.value.toLowerCase()),
        );
      } else if (filterCriteria.type === 'location') {
        filteredEvents = allEvents.filter((e) =>
          e.location
            .toLowerCase()
            .includes(filterCriteria.value.toLowerCase()),
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
    }

    if (filteredEvents.length === 0) {
      const userName = ctx.from?.first_name || 'aficionado';
      await ctx.reply(
        `Lo siento ${userName}, no se encontraron eventos con esos criterios.`,
      );
      ctx.scene.leave();
      return;
    }

    const totalPages = Math.ceil(
      filteredEvents.length / this.EVENTS_PER_PAGE,
    );
    const start = page * this.EVENTS_PER_PAGE;
    const end = start + this.EVENTS_PER_PAGE;
    const eventsToShow = filteredEvents.slice(start, end);

    const mensajes: string[] = [];

    for (const e of eventsToShow) {
      const fechaMsg = escapeMarkdownV2(e.fecha);
      const ciudad = escapeMarkdownV2(e.ciudad);
      const nombreEvento = escapeMarkdownV2(e.nombreEvento);
      const categoria = escapeMarkdownV2(e.categoria);
      const locationMsg = escapeMarkdownV2(e.location);
      const link = e.link
        ? `\n[🔗 Ver entradas](${escapeMarkdownUrl(e.link)})`
        : '';

      let weatherInfo = '';
      const eventDate = parseSpanishDate(e.fecha);
      if (eventDate) {
        const city = e.ciudad.split(',')[0].trim();
        weatherInfo = await this.weatherService.getWeatherForecastMessage(city, eventDate);
      }

      mensajes.push(`📅 *${fechaMsg}* \\- ${ciudad}\n*${nombreEvento}*\n_${categoria}_\n📍 ${locationMsg}${escapeMarkdownV2(weatherInfo)}${link}`);
    }

    const headerText = `Resultados (${start + 1}-${Math.min(end, filteredEvents.length)} de ${filteredEvents.length}):`;
    const messageHeader = `${escapeMarkdownV2(headerText)}\n\n`;
    
    // Fuente dinámica
    let fuenteUrl = 'www\\.servitoro\\.com';
    if (isMadridSearch) fuenteUrl = 'www\\.las\\-ventas\\.com';
    if (isSevillaSearch) fuenteUrl = 'www\\.diariodesevilla\\.es';
    
    const messageFooter = `\n\n📌 Fuente: ${fuenteUrl}`;
    const messageBody = mensajes.join('\n\n\\-\\-\\-\\-\\-\\-\n\n');
    const finalMessage = `${messageHeader}${messageBody}${messageFooter}`;

    const buttons = [Markup.button.callback('❌ Salir', 'exit_cal')];
    if (page < totalPages - 1) {
      buttons.push(Markup.button.callback('➡️ Siguiente', 'next_page_cal'));
    }

    await ctx.reply(finalMessage, {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard(buttons),
    });

    ctx.scene.session.currentCalFilter = filterCriteria;
    ctx.scene.session.currentCalPage = page;
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
}
