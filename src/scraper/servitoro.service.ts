import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as fs from 'fs/promises';
import * as path from 'path';
import puppeteer, { Browser } from 'puppeteer';
import chromium from 'chromium';
import * as cheerio from 'cheerio';

// La interfaz se mantiene para asegurar la estructura de datos
export interface ServitoroEvent {
  fecha: string;
  ciudad: string;
  nombreEvento: string;
  categoria: string;
  location:string;
  link: string | null;
}

@Injectable()
export class ServitoroService {
  private readonly logger = new Logger(ServitoroService.name);
  private readonly dataPath: string;
  private isScraping = false;

  constructor() {
    // Construimos la ruta al archivo de datos
    this.dataPath = path.join(process.cwd(), 'data', 'servitoro-events.json');
  }

  /**
   * Obtiene el calendario taurino directamente desde el archivo JSON local.
   * Este método es asíncrono y extremadamente rápido.
   * @returns Una Promesa que resuelve a un array de eventos de Servitoro.
   */
  async getCalendarioTaurino(): Promise<ServitoroEvent[]> {
    try {
      this.logger.log(`Leyendo datos desde: ${this.dataPath}`);
      const fileContent = await fs.readFile(this.dataPath, 'utf-8');
      const eventos = JSON.parse(fileContent);
      this.logger.log(`Se cargaron ${eventos.length} eventos desde el archivo.`);
      return eventos;
    } catch (error) {
      this.logger.error('Error al leer o parsear el archivo de datos de Servitoro.', error.stack);
      // Si el archivo no existe o hay un error, devolvemos un array vacío
      // para que la aplicación no se caiga.
      return [];
    }
  }

  /**
   * Tarea programada que se ejecuta cada domingo a las 3 AM para actualizar
   * los datos de los festejos de Servitoro.
   */
  @Cron('0 3 * * 0') // Cada domingo a las 3 AM
  async handleCron() {
    this.logger.log('Iniciando tarea programada: actualización de datos de Servitoro...');
    await this.updateEvents();
    this.logger.log('Tarea programada de actualización de Servitoro finalizada.');
  }

  /**
   * Este método contiene la lógica de scraping con Puppeteer y actualiza el archivo JSON.
   */
  private async updateEvents(): Promise<void> {
    if (this.isScraping) {
      this.logger.warn('El proceso de scraping ya está en ejecución. Se omite esta ejecución.');
      return;
    }

    this.isScraping = true;
    const url = 'https://www.servitoro.com/es/calendario-taurino';
    this.logger.log(`Iniciando scraping de ${url} con Puppeteer...`);

    let browser: Browser | null = null;

    try {
      const isRender = !!process.env.RENDER;
      browser = await puppeteer.launch({
        executablePath: isRender ? chromium.path : undefined,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const page = await browser.newPage();

      await page.setRequestInterception(true);
      page.on('request', (req) => {
        ['image', 'stylesheet', 'font'].includes(req.resourceType())
          ? req.abort()
          : req.continue();
      });

      await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      });

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
      await page.waitForSelector('.card.evento', { timeout: 30000 });

      this.logger.log('Página cargada. Verificando si hay un botón "Ver más"...');
      while (true) {
        const eventCount = (await page.$$('.card.evento')).length;
        this.logger.log(`Eventos en página actualmente: ${eventCount}`);

        const loadMoreButton = await page.$('xpath/.//a[contains(., "Ver más")]');

        if (loadMoreButton) {
          this.logger.log('Botón "Ver más" encontrado, haciendo clic...');
          await loadMoreButton.click();
          try {
            await page.waitForFunction(
              (selector, count) => document.querySelectorAll(selector).length > count,
              { timeout: 15000 },
              '.card.evento',
              eventCount,
            );
          } catch (timeoutError) {
            this.logger.log('Timeout esperando nuevos eventos. Se asume que todos han sido cargados.');
            break;
          }
        } else {
          this.logger.log('No se encontró el botón "Ver más". Se asume que todos los eventos están cargados.');
          break;
        }
      }

      this.logger.log('Extrayendo HTML final...');
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

      this.logger.log(`Scraping finalizado. Total de eventos encontrados: ${eventos.length}`);
      
      if (eventos.length > 0) {
        await fs.writeFile(this.dataPath, JSON.stringify(eventos, null, 2));
        this.logger.log(`¡Éxito! Archivo de datos actualizado en: ${this.dataPath}`);
      } else {
        this.logger.warn('El scraping no devolvió eventos. El archivo de datos no fue actualizado.');
      }

    } catch (error) {
      this.logger.error('El scraping falló.', error.stack);
    } finally {
      if (browser) await browser.close();
      this.isScraping = false;
      this.logger.log('Navegador cerrado y proceso de scraping finalizado.');
    }
  }

  /**
   * Este método ya no es necesario para el funcionamiento normal del bot,
   * pero lo mantenemos por si se necesita una limpieza manual de alguna
   * caché futura o por compatibilidad.
   */
  clearCache(): void {
    this.logger.warn('La operación clearCache ya no tiene un efecto principal, los datos se leen directamente del archivo.');
  }
}
