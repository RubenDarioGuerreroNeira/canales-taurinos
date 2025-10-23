import { Injectable, Logger } from '@nestjs/common';
import puppeteer from 'puppeteer'; // Re-introducimos puppeteer
import chromium from 'chromium'; // Necesario para entornos como Render
import * as cheerio from 'cheerio';

export interface ServitoroEvent {
  fecha: string;
  ciudad: string;
  nombreEvento: string;
  categoria: string;
  location: string;
  link: string | null;
}

@Injectable()
export class ServitoroService {
  private readonly logger = new Logger(ServitoroService.name);
  private readonly url = 'https://www.servitoro.com/es/calendario-taurino';

  async getCalendarioTaurino(): Promise<ServitoroEvent[]> {
    this.logger.log(`Iniciando scraping de ${this.url} con Puppeteer`);
    let browser; // Declaramos browser fuera del try para asegurar su cierre
    try {
      // Detectar si estamos en Render o local
      const isRender = !!process.env.RENDER;

      browser = await puppeteer.launch({
        executablePath: isRender ? chromium.path : undefined,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const page = await browser.newPage();

      // Optimización: Bloquear la carga de recursos innecesarios (CSS, imágenes, fuentes)
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.goto(this.url, {
        waitUntil: 'domcontentloaded', // Esperar solo al HTML, no a todos los recursos
        timeout: 60000, // Timeout de 60 segundos para la navegación
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
      });

      // Esperar a que los selectores de eventos se carguen dinámicamente
      await page.waitForSelector('.card.evento', { timeout: 30000 });

      // Obtener el HTML de la página una vez que el contenido está listo
      const html = await page.content();
      const $ = cheerio.load(html);
      const eventos: ServitoroEvent[] = [];

      // Selectores actualizados según tu investigación del DOM
      $('.card.evento').each((_, el) => {
        const cardBody = $(el).find('.card-body');

        const fecha = cardBody.find('.fecha').text().trim();
        const ciudad =
          cardBody.find('.ciudad').attr('data-nombre-ciudad')?.trim() ||
          'Ciudad no especificada';
        const nombreEvento = cardBody.find('.nombre-evento').text().trim();
        const categoria =
          cardBody.find('.evento-cat').text().trim() || 'No especificada';
        const location = cardBody.find('.location').text().trim();

        const enlace = cardBody.find('a.reservar').attr('href');
        const link = enlace
          ? enlace.startsWith('http')
            ? enlace
            : `https://www.servitoro.com${enlace}`
          : null;

        // Solo añadir si tenemos la información esencial
        if (fecha && nombreEvento)
          eventos.push({
            fecha,
            ciudad,
            nombreEvento,
            categoria,
            location,
            link,
          });
      });

      this.logger.log(`Eventos de Servitoro encontrados: ${eventos.length}`); // Log actualizado
      return eventos;
    } catch (error) {
      this.logger.error('Error al scrapear Servitoro', error.stack);
      return [];
    } finally {
      if (browser) {
        await browser.close(); // Aseguramos el cierre del navegador
      }
    }
  }
}
