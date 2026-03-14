import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as cheerio from 'cheerio';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Browser } from 'puppeteer';
import { EscalafonEntry } from './interfaces/torero.interface';
import { BaseJsonDataService } from './base-json-data.service';
import { PuppeteerService } from './puppeteer.service';

@Injectable()
export class MundotoroEscalafonService extends BaseJsonDataService<EscalafonEntry[]> {
  protected readonly logger = new Logger(MundotoroEscalafonService.name);
  private readonly url = 'https://www.mundotoro.com/escalafon-toreros';

  constructor(private readonly puppeteerService: PuppeteerService) {
    super('escalafon.json');
  }

  protected getDefaultData(): EscalafonEntry[] {
    return [];
  }

  @Cron('0 3 * * 0')
  async handleCron() {
    this.logger.log('Iniciando tarea programada: actualización de Escalafón...');
    try {
      if (!(await this.shouldRunScheduled())) {
        this.logger.log('Saltando actualización: no han pasado 15 días.');
        return;
      }
      await this.scrapeAndCache();
      await this.markScheduledRun();
    } catch (error) {
      this.logger.error('La tarea programada falló.', error);
    }
  }

  async getEscalafon(): Promise<EscalafonEntry[]> {
    const data = await this.ensureDataLoaded();
    if (data.length === 0) return this.scrapeAndCache();
    return data;
  }

  private async scrapeAndCache(): Promise<EscalafonEntry[]> {
    let browser: Browser | null = null;
    try {
      browser = await this.puppeteerService.launchBrowser();
      const page = await this.puppeteerService.setupPage(browser);

      this.logger.log(`Navegando a: ${this.url}`);
      await page.goto(this.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await new Promise((r) => setTimeout(r, 5000));

      // Manejar cookies
      const cookieButton = await page.$('button.cmplz-btn.cmplz-accept');
      if (cookieButton) {
        await cookieButton.click();
        await new Promise((r) => setTimeout(r, 2000));
      }

      const content = await page.content();
      const $ = cheerio.load(content);
      const rankings: EscalafonEntry[] = [];

      const table = $('table.listadoTabla, table#sorter, table').filter((i, el) => $(el).find('tr').length > 5).first();

      table.find('tbody tr, tr').each((index, element) => {
        const cells = $(element).find('td');
        if (cells.length < 5) return;

        const positionText = cells.eq(0).text().trim();
        const nombreCompleto = cells.eq(1).text().trim();

        if (positionText && nombreCompleto && !isNaN(parseInt(positionText, 10))) {
          const parseNum = (s: string) => parseInt(s.replace(/[^0-9]/g, '') || '0', 10);
          
          rankings.push({
            posicion: positionText,
            lidiador: nombreCompleto,
            festejos: String(parseNum(cells.eq(5).text()) + parseNum(cells.eq(6).text()) + parseNum(cells.eq(7).text())),
            orejas: String(parseNum(cells.eq(8).text()) + parseNum(cells.eq(9).text()) + parseNum(cells.eq(10).text())),
            rabos: cells.eq(4).text().trim(),
          });
        }
      });

      if (rankings.length > 0) {
        await this.saveData(rankings);
      }
      return rankings;
    } catch (error) {
      this.logger.error(`Error en scraping: ${error.message}`);
      return [];
    } finally {
      if (browser) await browser.close();
    }
  }

  private getScheduleMarkerPath(): string {
    return path.join(process.cwd(), 'data', 'last_escalafon_update.txt');
  }

  private async shouldRunScheduled(): Promise<boolean> {
    const marker = this.getScheduleMarkerPath();
    const content = await fs.readFile(marker, 'utf-8').catch(() => null);
    if (!content) return true;
    const last = new Date(content.trim()).getTime();
    return Date.now() - last >= 15 * 24 * 60 * 60 * 1000;
  }

  private async markScheduledRun(): Promise<void> {
    const marker = this.getScheduleMarkerPath();
    await fs.mkdir(path.dirname(marker), { recursive: true });
    await fs.writeFile(marker, new Date().toISOString(), 'utf-8');
  }
}
