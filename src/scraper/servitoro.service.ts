import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer'; // Re-introducimos puppeteer
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
export class ServitoroService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ServitoroService.name);
  private readonly url = 'https://www.servitoro.com/es/calendario-taurino';
  private cachedEventos: ServitoroEvent[] | null = null;
  private lastFetched: Date | null = null;
  private browser: Browser | null = null;

  async onModuleInit() {
    this.logger.log('Inicializando el navegador para ServitoroService...');
    await this.getBrowserInstance();
  }

  async onModuleDestroy() {
    if (this.browser) {
      this.logger.log('Cerrando el navegador de ServitoroService...');
      await this.browser.close();
    }
  }

  async getCalendarioTaurino(): Promise<ServitoroEvent[]> {
    const now = new Date();
    // Cache de 1 hora
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    if (
      this.cachedEventos &&
      this.lastFetched &&
      this.lastFetched > oneHourAgo
    ) {
      this.logger.log('Usando caché de eventos de Servitoro');
      return this.cachedEventos;
    }

    const eventos = await this.fetchAndParse();
    this.cachedEventos = eventos;
    this.lastFetched = now;
    return eventos;
  }

  private async getBrowserInstance(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }
    this.logger.log('Lanzando una nueva instancia del navegador...');
    try {
      const isRender = !!process.env.RENDER;
      this.browser = await puppeteer.launch({
        executablePath: isRender ? chromium.path : undefined,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      return this.browser;
    } catch (error) {
      this.logger.error('No se pudo lanzar el navegador', error.stack);
      throw error;
    }
  }

  private async fetchAndParse(): Promise<ServitoroEvent[]> {
    this.logger.log(`Iniciando scraping de ${this.url} con Puppeteer`);
    try {
      const browser = await this.getBrowserInstance();
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

      // Establecer las cabeceras HTTP para simular un navegador real
      await page.setExtraHTTPHeaders({
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      });

      await page.goto(this.url, {
        // 'networkidle2' es más robusto para sitios que cargan contenido dinámicamente.
        // Espera hasta que no haya más de 2 conexiones de red durante al menos 500 ms.
        waitUntil: 'networkidle2',
        // Aumentamos el timeout para dar más margen a sitios lentos o con protecciones.
        timeout: 90000, // Timeout de 90 segundos para la navegación
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
      this.logger.error('Error durante el scraping de Servitoro', error.stack);
      return [];
    }
  }

  clearCache(): void {
    this.cachedEventos = null;
    this.lastFetched = null;
    this.logger.log('Caché de Servitoro invalidada manualmente.');
  }
}
