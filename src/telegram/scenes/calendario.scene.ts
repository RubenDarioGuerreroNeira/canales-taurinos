import { Injectable } from '@nestjs/common';
import { Scenes, Markup } from 'telegraf';
import { MyContext } from '../telegram.interfaces';
import { ServitoroEvent } from '../../scraper/servitoro.service';

@Injectable()
export class CalendarioSceneService {
    create(): Scenes.BaseScene<MyContext> {
        const scene = new Scenes.BaseScene<MyContext>('calendarioScene');
        const EVENTS_PER_PAGE = 3;

        scene.enter(async (ctx) => {
            const userName = ctx.from?.first_name || 'aficionado';
            const totalEvents = ctx.scene.session.servitoroEvents?.length || 0;
            await ctx.reply(
                `¡Hola ${userName}! He Encontrado ${totalEvents} eventos taurinos. ¿Cómo te gustaría filtrar los?`,
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
                .map((m) => `\`${this.escapeMarkdownV2(m)}\``)
                .join(', ');
            ctx.scene.session.filterStateCal = 'awaiting_month_cal';
            await ctx.reply(
                `${this.escapeMarkdownV2(`¡Perfecto ${userName}! Por favor, escribe el nombre del mes. Meses disponibles:`)} ${monthList}`,
                {
                    parse_mode: 'MarkdownV2',
                },
            );
        });

        scene.action('filter_city_cal', async (ctx) => {
            ctx.scene.session.filterStateCal = 'awaiting_city_cal';
            await ctx.answerCbQuery();
            const userName = ctx.from?.first_name || 'aficionado';
            await ctx.reply(
                `¡Entendido ${userName}! Por favor, escribe el nombre de la ciudad (ej: "Sevilla").`,
            );
        });

        scene.action('filter_location_cal', async (ctx) => {
            ctx.scene.session.filterStateCal = 'awaiting_location_cal';
            await ctx.answerCbQuery();
            const userName = ctx.from?.first_name || 'aficionado';
            await ctx.reply(
                `¡Claro ${userName}! Por favor, escribe la localidad (ej: "Las Ventas").`,
            );
        });

        scene.action('filter_free_cal', async (ctx) => {
            ctx.scene.session.filterStateCal = 'awaiting_free_text_cal';
            await ctx.answerCbQuery();
            const userName = ctx.from?.first_name || 'aficionado';
            await ctx.reply(
                `¡Adelante ${userName}! Escribe tu búsqueda (ej: "Madrid en Octubre").`,
            );
        });

        scene.action('next_page_cal', async (ctx) => {
            await ctx.answerCbQuery();
            const currentPage = ctx.scene.session.currentCalPage || 0;
            const filter = ctx.scene.session.currentCalFilter;
            if (filter) {
                await this.showFilteredCalendarioEvents(ctx, filter, currentPage + 1);
            } else {
                const userName = ctx.from?.first_name || 'aficionado';
                await ctx.reply(
                    `Lo siento ${userName}, hubo un error: No se encontró el filtro actual para la paginación.`,
                );
                ctx.scene.leave();
            }
        });

        scene.action('exit_cal', async (ctx) => {
            await ctx.answerCbQuery();
            ctx.scene.session.filterStateCal = undefined;
            const userName = ctx.from?.first_name || 'aficionado';
            await ctx.reply(
                `¡De acuerdo ${userName}! ¿En qué más puedo ayudarte?\n\nPuedes preguntar por la "tarnsmisiones de festejos que puedes ver aquí " o consultar el "calendario taurino" de nuevo cuando quieras, solo escribiendo "calendario".`,
            );
            await ctx.scene.leave();
        });

        scene.on('text', async (ctx) => {
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
        const EVENTS_PER_PAGE = 3;
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
            const userName = ctx.from?.first_name || 'aficionado';
            await ctx.reply(
                `Lo siento ${userName}, no se encontraron eventos con esos criterios.`,
            );
            ctx.scene.leave();
            return;
        }

        const totalPages = Math.ceil(filteredEvents.length / EVENTS_PER_PAGE);
        const start = page * EVENTS_PER_PAGE;
        const end = start + EVENTS_PER_PAGE;
        const eventsToShow = filteredEvents.slice(start, end);

        if (eventsToShow.length === 0 && page > 0) {
            const userName = ctx.from?.first_name || 'aficionado';
            await ctx.reply(`Lo siento ${userName}, no hay más eventos para mostrar.`);
            ctx.scene.leave();
            return;
        } else if (eventsToShow.length === 0) {
            const userName = ctx.from?.first_name || 'aficionado';
            await ctx.reply(
                `Lo siento ${userName}, no se encontraron eventos con esos criterios.`,
            );
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
}
