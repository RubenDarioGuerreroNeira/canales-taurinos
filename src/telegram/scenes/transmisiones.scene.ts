import { Injectable } from '@nestjs/common';
import { Scenes, Markup } from 'telegraf';
import { ScraperService } from '../../scraper/scraper.service';
import { ServitoroService } from '../../scraper/servitoro.service';
import { WeatherService } from '../../weather/weather.service';
import { MyContext } from '../telegram.interfaces';
import {
    escapeMarkdownV2,
    parseSpanishDate,
} from '../../utils/telegram-format';

@Injectable()
export class TransmisionesSceneService {
    constructor(
        private readonly scraperService: ScraperService,
        private readonly servitoroService: ServitoroService,
        private readonly weatherService: WeatherService,
    ) { }

    create(): Scenes.BaseScene<MyContext> {
        const scene = new Scenes.BaseScene<MyContext>('transmisionesScene');

        scene.enter(async (ctx) => {
            console.log('--- ENTRANDO EN TRANSMISIONES SCENE ---');
            const userName = ctx.from?.first_name || 'aficionado';
            console.log(`Usuario: ${userName}`);
            try {
                await ctx.reply(
                    `¡Hola ${userName}! ¿Cómo te gustaría filtrar las transmisiones de las corridas?`,
                    Markup.inlineKeyboard([
                        [Markup.button.callback('📅 Ver Todas', 'ver_todas')],
                        [
                            Markup.button.callback('🗓️ Por Mes', 'filtrar_mes'),
                            Markup.button.callback('📺 Por Canal', 'filtrar_canal'),
                        ],
                    ]),
                );
                console.log('Respuesta de bienvenida enviada correctamente.');
            } catch (error) {
                console.error('Error al enviar respuesta de bienvenida en escena:', error);
            }
        });

        scene.action('ver_todas', async (ctx) => {
            console.log('--- ACCIÓN: ver_todas ---');
            try {
                await ctx.answerCbQuery();
                console.log('Callback respondido.');
                await this.showFilteredEvents(ctx, () => true);
                console.log('Eventos mostrados. Saliendo de escena.');
                await ctx.scene.leave();
            } catch (error) {
                console.error('Error en acción ver_todas:', error);
                await ctx.reply('Lo siento, hubo un error al procesar tu solicitud.');
            }
        });

        scene.action('filtrar_mes', async (ctx) => {
            console.log('--- ACCIÓN: filtrar_mes ---');
            ctx.scene.session.filterState = 'awaiting_month';
            await ctx.answerCbQuery();
            const userName = ctx.from?.first_name || 'aficionado';
            await ctx.reply(
                `¡Claro ${userName}! Por favor, escribe el nombre del mes que te interesa (ej: "Octubre").`,
            );
        });

        scene.action('filtrar_canal', async (ctx) => {
            console.log('--- ACCIÓN: filtrar_canal ---');
            await ctx.answerCbQuery();
            const userName = ctx.from?.first_name || 'aficionado';
            await ctx.reply(`¡Hola ${userName}! Consultando canales disponibles...`);
            console.log('Llamando al scraper para filtrar canales...');
            const allEvents = await this.scraperService.scrapeTransmisiones();
            console.log(`Scraping completado. ${allEvents.length} eventos encontrados.`);
            const channels = [
                ...new Set(
                    allEvents.flatMap((ev) =>
                        ev.enlaces.map((link) => this.getChannelNameFromUrl(link.url, 0)),
                    ),
                ),
            ];

            if (channels.length === 0) {
                await ctx.reply(
                    `Lo siento ${userName}, no hay canales con transmisiones programadas ahora mismo.`,
                );
                return ctx.scene.leave();
            }

            const buttons = channels.map((channel) =>
                Markup.button.callback(channel, `canal_${channel}`),
            );
            await ctx.reply(
                `¡Perfecto ${userName}! Selecciona un canal presionando uno de los botones:`,
                Markup.inlineKeyboard(buttons, { columns: 2 }),
            );
        });

        scene.action(/canal_(.+)/, async (ctx) => {
            const channel = ctx.match[1];
            console.log(`--- ACCIÓN: filtrar por canal ${channel} ---`);
            await ctx.answerCbQuery();
            await this.showFilteredEvents(ctx, (ev) =>
                ev.enlaces.some(
                    (link) => this.getChannelNameFromUrl(link.url, 0) === channel,
                ),
            );
            await ctx.scene.leave();
        });

        scene.on('text', async (ctx) => {
            if (ctx.scene.session.filterState === 'awaiting_month') {
                const month = ctx.message.text.trim();
                const userName = ctx.from?.first_name || 'aficionado';
                console.log(`--- MES RECIBIDO: ${month} ---`);
                
                // Guardamos el mes en la sesión
                ctx.scene.session.selectedMonth = month;
                ctx.scene.session.filterState = undefined;

                // Intentamos mostrar las transmisiones directamente
                const found = await this.showFilteredEvents(ctx, (ev) => 
                    ev.fecha.toLowerCase().includes(month.toLowerCase()),
                    month
                );

                // Si encontramos resultados, dejamos la escena. 
                // Si no, nos quedamos para que el usuario pueda pulsar "Ver Calendario" o intentarlo de nuevo.
                if (found) {
                    await ctx.scene.leave();
                }
            }
        });

        scene.action('exit_transmisiones', async (ctx) => {
            await ctx.answerCbQuery();
            await ctx.reply('De acuerdo. Si necesitas algo más, solo dímelo.');
            await ctx.scene.leave();
        });

        scene.action(/tipo_transmision_(.+)/, async (ctx) => {
            const month = ctx.match[1].toLowerCase();
            console.log(`--- FILTRANDO TRANSMISIONES POR MES: ${month} ---`);
            await ctx.answerCbQuery();
            const found = await this.showFilteredEvents(ctx, (ev) =>
                ev.fecha.toLowerCase().includes(month),
            );
            if (found) await ctx.scene.leave();
        });

        scene.action(/tipo_calendario_(.+)/, async (ctx) => {
            const month = ctx.match[1].toLowerCase();
            console.log(`--- FILTRANDO CALENDARIO POR MES: ${month} ---`);
            await ctx.answerCbQuery();
            
            const userName = ctx.from?.first_name || 'aficionado';
            await ctx.reply(`¡Perfecto ${userName}! Buscando los carteles de la temporada para ${month}...`);
            
            await this.showCalendarEvents(ctx, month);
            await ctx.scene.leave();
        });

        return scene;
    }

    private async showFilteredEvents(
        ctx: MyContext,
        filterFn: (ev: any) => boolean,
        month?: string,
    ): Promise<boolean> {
        const userName = ctx.from?.first_name || 'aficionado';
        console.log(`Mostrando eventos filtrados para ${userName}...`);
        try {
            await ctx.reply(`¡Hola ${userName}! Buscando transmisiones...`);
            console.log('Llamando al scraper...');
            const allEvents = await this.scraperService.scrapeTransmisiones();
            console.log(`Scraping finalizado. Total eventos: ${allEvents.length}`);
            const events = allEvents.filter(filterFn);
            console.log(`Eventos tras filtro: ${events.length}`);

            if (!events.length) {
                if (month) {
                    const rawMsg = `Lo siento ${userName}, no encontré transmisiones de TV para el mes de **${month}**. ¿Te gustaría consultar el calendario de temporada para ver qué festejos hay programados?`;
                    const escapedMsg = this.escapeMarkdownV2(rawMsg).replace(/\\\*\\\*/g, '**');

                    await ctx.reply(escapedMsg, {
                        parse_mode: 'MarkdownV2',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback(`🗓️ Ver Calendario de ${month}`, `tipo_calendario_${month}`)],
                            [Markup.button.callback(`❌ Salir`, 'exit_transmisiones')]
                        ])
                    });
                } else {
                    await ctx.reply(
                        `Lo siento ${userName}, no se encontraron transmisiones con ese filtro.`,
                    );
                }
                return false;
            }

            for (const ev of events.slice(0, 10)) {
                const mensaje = `🗓 *${this.escapeMarkdownV2(ev.fecha)}*\n_${this.escapeMarkdownV2(ev.descripcion)}_`;
                const botones = ev.enlaces.map((link, index) =>
                    Markup.button.url(
                        this.getChannelNameFromUrl(link.url, index),
                        link.url,
                    ),
                );
                try {
                    if (botones.length > 0) {
                        await ctx.reply(mensaje, {
                            parse_mode: 'MarkdownV2',
                            ...Markup.inlineKeyboard(botones),
                        });
                    } else {
                        await ctx.reply(mensaje, { parse_mode: 'MarkdownV2' });
                    }
                } catch (sendError) {
                    console.error(`Error enviando evento: ${ev.fecha}`, sendError.message);
                    // Intento enviar sin Markdown si falla
                    await ctx.reply(`🗓 ${ev.fecha}\n${ev.descripcion}`).catch(() => {});
                }
            }
            console.log('Mensajes de eventos enviados.');
            await ctx.reply(`¡Gracias ${userName}! 📌 Fuente: www.elmuletazo.com`);
            return true;
        } catch (error) {
            console.error('Error en showFilteredEvents:', error);
            await ctx.reply('Lo siento, tuve un problema al buscar las transmisiones.');
            return false;
        }
    }

    private async showCalendarEvents(ctx: MyContext, month: string) {
        const userName = ctx.from?.first_name || 'aficionado';
        try {
            const allEvents = await this.servitoroService.getCalendarioTaurino();
            const filteredEvents = allEvents.filter(e => 
                e.fecha.toLowerCase().includes(month.toLowerCase())
            );

            if (filteredEvents.length === 0) {
                await ctx.reply(`Lo siento ${userName}, no encontré festejos programados en el calendario para ${month}.`);
                
                await ctx.reply(`¿En qué más puedo acompañarte hoy?`, {
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback('📺 Transmisiones', 'show_transmisiones'),
                            Markup.button.callback('🗓️ Temporada', 'show_temporada'),
                        ],
                        [
                            Markup.button.callback('🏆 Escalafón', 'show_escalafon_action'),
                            Markup.button.callback('🌎 América', 'filter_america_cities'),
                        ],
                        [Markup.button.callback('🏠 Ir al Inicio', 'show_intro')]
                    ])
                });
                return;
            }

            // Mostrar los primeros 5 eventos para no saturar
            for (const e of filteredEvents.slice(0, 5)) {
                let weatherInfo = '';
                const eventDate = parseSpanishDate(e.fecha);
                if (eventDate) {
                    const city = e.ciudad.split(',')[0].trim();
                    weatherInfo = await this.weatherService.getWeatherForecastMessage(city, eventDate);
                }

                const mensaje = `🗓 *${this.escapeMarkdownV2(e.fecha)}* \\- ${this.escapeMarkdownV2(e.ciudad)}\n` +
                    `*${this.escapeMarkdownV2(e.nombreEvento)}*\n` +
                    `_${this.escapeMarkdownV2(e.categoria)}_\n` +
                    `📍 ${this.escapeMarkdownV2(e.location)}${this.escapeMarkdownV2(weatherInfo)}`;

                const botones: any[][] = [];
                if (e.link) {
                    botones.push([Markup.button.url('🔗 Ver Entradas', e.link)]);
                }

                await ctx.reply(mensaje, {
                    parse_mode: 'MarkdownV2',
                    ...Markup.inlineKeyboard(botones)
                });
            }

            if (filteredEvents.length > 5) {
                await ctx.reply(`He mostrado los primeros 5 festejos de los ${filteredEvents.length} encontrados para ${month}. Si quieres ver más, puedes usar el comando /calendario.`);
            }

            await ctx.reply(`¡Gracias ${userName}! 📌 Fuente: www.servitoro.com`);
        } catch (error) {
            console.error('Error en showCalendarEvents:', error);
            await ctx.reply('Lo siento, hubo un problema al consultar el calendario de temporada.');
        }
    }

    private escapeMarkdownV2(text: string): string {
        if (!text) return '';
        return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
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
}
