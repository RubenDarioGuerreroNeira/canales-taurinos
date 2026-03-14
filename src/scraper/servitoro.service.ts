import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as cheerio from 'cheerio';
import { Browser } from 'puppeteer';
import { BaseJsonDataService } from './base-json-data.service';
import { PuppeteerService } from './puppeteer.service';

export interface ServitoroEvent {
  fecha: string;
  ciudad: string;
  nombreEvento: string;
  categoria: string;
  location: string;
  link: string | null;
}

@Injectable()
export class ServitoroService extends BaseJsonDataService<ServitoroEvent[]> {
  protected readonly logger = new Logger(ServitoroService.name);
  private isScraping = false;

  constructor(private readonly puppeteerService: PuppeteerService) {
    super('servitoro-events.json');
  }

  protected getDefaultData(): ServitoroEvent[] {
    return [];
  }

  async getCalendarioTaurino(): Promise<ServitoroEvent[]> {
    return this.ensureDataLoaded();
  }

  @Cron('0 3 * * 0')
  async handleCron() {
    this.logger.log('Iniciando tarea programada: actualización de datos de Servitoro...');
    await this.updateEvents();
    this.logger.log('Tarea programada de actualización de Servitoro finalizada.');
  }

  private async updateEvents(): Promise<void> {
    if (this.isScraping) {
      this.logger.warn('El proceso de scraping ya está en ejecución. Se omite esta ejecución.');
      return;
    }

    this.isScraping = true;
    const url = 'https://www.servitoro.com/es/calendario-taurino';
    this.logger.log(`Iniciando scraping de ${url}...`);

    let browser: Browser | null = null;

    try {
      browser = await this.puppeteerService.launchBrowser();
      const page = await this.puppeteerService.setupPage(browser);
      await this.puppeteerService.blockUnnecessaryResources(page);

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
      await page.waitForSelector('.card.evento', { timeout: 30000 });

      while (true) {
        const eventCount = (await page.$$('.card.evento')).length;
        const loadMoreButton = await page.$('xpath/.//a[contains(., "Ver más")]');

        if (loadMoreButton) {
          await loadMoreButton.click();
          try {
            await page.waitForFunction(
              (selector, count) => document.querySelectorAll(selector).length > count,
              { timeout: 15000 },
              '.card.evento',
              eventCount,
            );
          } catch (timeoutError) {
            break;
          }
        } else {
          break;
        }
      }

      const html = await page.content();
      const $ = cheerio.load(html);
      const eventos: ServitoroEvent[] = [];

      $('.card.evento').each((_, el) => {
        const cardBody = $(el).find('.card-body');
        const fecha = cardBody.find('.fecha').text().trim();
        const ciudad = cardBody.find('.ciudad').attr('data-nombre-ciudad')?.trim() || 'Ciudad no especificada';
        const nombreEvento = cardBody.find('.nombre-evento').text().trim();
        const categoria = cardBody.find('.evento-cat').text().trim() || 'No especificada';
        const location = cardBody.find('.location').text().trim();
        const enlace = cardBody.find('a.reservar').attr('href');
        const link = enlace ? (enlace.startsWith('http') ? enlace : `https://www.servitoro.com${enlace}`) : null;

        if (fecha && nombreEvento)
          eventos.push({ fecha, ciudad, nombreEvento, categoria, location, link });
      });

      if (eventos.length > 0) {
        await this.saveData(eventos);
      }

    } catch (error) {
      this.logger.error('El scraping falló.', error.stack);
    } finally {
      if (browser) await browser.close();
      this.isScraping = false;
    }
  }

  clearCache(): void {
    this.data = null;
    this.logger.warn('Caché de Servitoro invalidada en memoria.');
  }
}
