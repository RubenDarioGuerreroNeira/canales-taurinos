import { Injectable } from '@nestjs/common';
import { Scenes, Markup } from 'telegraf';
import { ScraperService } from '../../scraper/scraper.service';
import { MyContext } from '../telegram.interfaces';

@Injectable()
export class TransmisionesSceneService {
    constructor(private readonly scraperService: ScraperService) { }

    create(): Scenes.BaseScene<MyContext> {
        const scene = new Scenes.BaseScene<MyContext>('transmisionesScene');

        scene.enter(async (ctx) => {
            const userName = ctx.from?.first_name || 'aficionado';
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
        });

        scene.action('ver_todas', async (ctx) => {
            await ctx.answerCbQuery();
            await this.showFilteredEvents(ctx, () => true);
            await ctx.scene.leave();
        });

        scene.action('filtrar_mes', async (ctx) => {
            ctx.scene.session.filterState = 'awaiting_month';
            await ctx.answerCbQuery();
            const userName = ctx.from?.first_name || 'aficionado';
            await ctx.reply(
                `¡Claro ${userName}! Por favor, escribe el nombre del mes que te interesa (ej: "Octubre").`,
            );
        });

        scene.action('filtrar_canal', async (ctx) => {
            await ctx.answerCbQuery();
            const userName = ctx.from?.first_name || 'aficionado';
            await ctx.reply(`¡Hola ${userName}! Consultando canales disponibles...`);
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
                const month = ctx.message.text.toLowerCase();
                await this.showFilteredEvents(ctx, (ev) =>
                    ev.fecha.toLowerCase().includes(month),
                );
                await ctx.scene.leave();
            }
        });

        return scene;
    }

    private async showFilteredEvents(
        ctx: MyContext,
        filterFn: (ev: any) => boolean,
    ) {
        const userName = ctx.from?.first_name || 'aficionado';
        await ctx.reply(`¡Hola ${userName}! Buscando transmisiones...`);
        const allEvents = await this.scraperService.scrapeTransmisiones();
        const events = allEvents.filter(filterFn);

        if (!events.length) {
            await ctx.reply(
                `Lo siento ${userName}, no se encontraron transmisiones con ese filtro.`,
            );
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
        await ctx.reply(`¡Gracias ${userName}! 📌 Fuente: www.elmuletazo.com`);
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
