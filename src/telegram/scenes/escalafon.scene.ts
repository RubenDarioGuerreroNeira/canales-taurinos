import { Injectable, Logger } from '@nestjs/common';
import { Scenes, Markup } from 'telegraf';
import { MyContext } from '../telegram.interfaces';
import { MundotoroEscalafonService } from '../../scraper/mundotoroEscalafon.service';
import { EscalafonEntry } from '../../scraper/interfaces/torero.interface';

const ITEMS_PER_PAGE = 5;

type CallbackButton = ReturnType<typeof Markup.button.callback>;

@Injectable()
export class EscalafonSceneService {
  private readonly logger = new Logger(EscalafonSceneService.name);

  constructor(private mundotoroEscalafonService: MundotoroEscalafonService) {}

  private escapeMarkdownV2(text: string): string {
    if (!text) return '';
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }

  create(): Scenes.BaseScene<MyContext> {
    const scene = new Scenes.BaseScene<MyContext>('escalafonScene');

    scene.enter(async (ctx) => {
      await ctx.reply(
        'Consultando el escalafón taurino de Mundotoro, un momento por favor...',
      );
      try {
        let escalafonData = await this.mundotoroEscalafonService.getEscalafon();

        if (!escalafonData || escalafonData.length === 0) {
          await ctx.reply(
            'Lo siento, no pude obtener los datos del escalafón en este momento.',
          );
          return ctx.scene.leave();
        }

        // Limitar a los primeros 50 toreros
        escalafonData = escalafonData.slice(0, 50);

        ctx.scene.session.escalafonData = escalafonData;
        ctx.scene.session.currentPage = 0;

        await this.showPage(ctx);
      } catch (error) {
        this.logger.error('Error al obtener el escalafón', error);
        await ctx.reply(
          'Ocurrió un error al consultar el escalafón. Por favor, inténtalo más tarde.',
        );
        return ctx.scene.leave();
      }
    });

    scene.action(/page_(\d+)/, async (ctx) => {
      const page = parseInt(ctx.match[1], 10);
      ctx.scene.session.currentPage = page;
      await ctx.answerCbQuery();
      await this.showPage(ctx, true); // true para editar el mensaje
    });

    scene.action('exit_escalafon', async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.editMessageText('De acuerdo. ¿En qué más puedo ayudarte?');
      return ctx.scene.leave();
    });

    return scene;
  }

  private async showPage(ctx: MyContext, edit = false) {
    const { escalafonData, currentPage } = ctx.scene.session;

    if (escalafonData === undefined || currentPage === undefined) {
      this.logger.error('Faltan datos de sesión en showPage de EscalafonScene');
      await ctx.reply(
        'Ha ocurrido un error inesperado. Por favor, inicia de nuevo.',
      );
      return ctx.scene.leave();
    }

    const totalPages = Math.ceil(escalafonData.length / ITEMS_PER_PAGE);
    const start = currentPage * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const pageItems = escalafonData.slice(start, end);

    let message = '🏆 *Escalafón Taurino \\- Matadores de Toros*\n\n';
    pageItems.forEach((item: EscalafonEntry) => {
      message += `*${item.posicion}\\.* ${this.escapeMarkdownV2(item.lidiador)}\n`;
      message += `   *Festejos:* ${item.festejos}\n`;
      message += `   *Orejas:* ${item.orejas}\n`;
      message += `   *Rabos:* ${item.rabos}\n\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n`;
    });

    const buttons: CallbackButton[] = [];
    if (currentPage > 0) {
      buttons.push(
        Markup.button.callback('⬅️ Anterior', `page_${currentPage - 1}`),
      );
    }
    if (currentPage < totalPages - 1) {
      buttons.push(
        Markup.button.callback('Siguiente ➡️', `page_${currentPage + 1}`),
      );
    }

    const keyboard = Markup.inlineKeyboard(
      [...buttons, Markup.button.callback('❌ Salir', 'exit_escalafon')],
      { columns: buttons.length > 0 ? 2 : 1 },
    );

    const pageInfo = `Página ${currentPage + 1} de ${totalPages}`;
    const fullMessage = `${message}\n*${pageInfo}*`;

    try {
      if (edit) {
        await ctx.editMessageText(fullMessage, {
          parse_mode: 'MarkdownV2',
          ...keyboard,
        });
      } else {
        await ctx.reply(fullMessage, { parse_mode: 'MarkdownV2', ...keyboard });
      }
    } catch (error) {
      this.logger.error(
        'Error al enviar o editar el mensaje de la página del escalafón',
        error,
      );
      await ctx.reply(
        'Tuve problemas al mostrar la página. Inténtalo de nuevo.',
      );
    }
  }
}
