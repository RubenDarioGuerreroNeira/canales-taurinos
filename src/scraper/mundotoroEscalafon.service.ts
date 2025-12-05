import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as cheerio from 'cheerio';
import * as fs from 'fs/promises';
import * as path from 'path';
import puppeteer from 'puppeteer';
import { v4 as uuidv4 } from 'uuid';
import { EscalafonEntry } from './interfaces/torero.interface';

@Injectable()
export class MundotoroEscalafonService {
  private readonly logger = new Logger(MundotoroEscalafonService.name);
  private readonly dataPath: string;
  private readonly url = 'https://www.mundotoro.com/escalafon-toreros'; // URL correcta para el scraping

  constructor() {
    this.dataPath = path.join(process.cwd(), 'data', 'escalafon.json');
  }

  @Cron('0 3 * * 0') // Cada domingo a las 3 AM
  async handleCron() {
    this.logger.log(
      'Iniciando tarea programada: verificación de actualización de Escalafón...',
    );
    try {
      const shouldRun = await this.shouldRunScheduled();
      if (!shouldRun) {
        this.logger.log(
          'Saltando actualización: no han pasado 15 días desde la última ejecución.',
        );
        return;
      }

      await this.scrapeAndCache();
      await this.markScheduledRun();
      this.logger.log(
        'Tarea programada de actualización de Escalafón finalizada.',
      );
    } catch (error) {
      this.logger.error(
        'La tarea programada de actualización de Escalafón falló.',
        error,
      );
    }
  }

  private getScheduleMarkerPath(): string {
    return path.join(process.cwd(), 'data', 'last_escalafon_update.txt');
  }

  private async shouldRunScheduled(): Promise<boolean> {
    try {
      const marker = this.getScheduleMarkerPath();
      const content = await fs.readFile(marker, 'utf-8').catch(() => null);
      if (!content) return true; // nunca ejecutado -> ejecutar
      const last = new Date(content.trim()).getTime();
      if (isNaN(last)) return true;
      const now = Date.now();
      const diff = now - last;
      const FIFTEEN_DAYS = 15 * 24 * 60 * 60 * 1000;
      return diff >= FIFTEEN_DAYS;
    } catch (e) {
      this.logger.error(
        'Error comprobando marca de programación, asumiendo que se debe ejecutar.',
        e,
      );
      return true;
    }
  }

  private async markScheduledRun(): Promise<void> {
    try {
      const marker = this.getScheduleMarkerPath();
      await fs.mkdir(path.dirname(marker), { recursive: true });
      await fs.writeFile(marker, new Date().toISOString(), 'utf-8');
      this.logger.log(`Marca de última ejecución actualizada: ${marker}`);
    } catch (e) {
      this.logger.error(
        'No se pudo actualizar la marca de última ejecución.',
        e,
      );
    }
  }

  async getEscalafon(): Promise<EscalafonEntry[]> {
    try {
      const fileContent = await fs.readFile(this.dataPath, 'utf-8');
      const data = JSON.parse(fileContent);
      this.logger.log(
        `Datos de escalafón cargados desde ${this.dataPath}. Se encontraron ${data.length} registros.`,
      );
      if (data.length === 0) {
        this.logger.warn(
          'El archivo de caché de escalafón está vacío. Reintentando scrape...',
        );
        return this.scrapeAndCache();
      }
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.logger.warn(
          `El archivo ${this.dataPath} no existe. Realizando scraping inicial con Puppeteer...`,
        );
        return this.scrapeAndCache();
      }
      this.logger.error(
        'Error al leer o parsear el archivo de datos de escalafón.',
        error,
      );
      return this.scrapeAndCache(); // Si hay otro error (ej. JSON malformado), intentar un rescrapeo.
    }
  }

  private async scrapeAndCache(): Promise<EscalafonEntry[]> {
    let browser;
    let userDataDir;
    try {
      this.logger.log('Lanzando instancia de Puppeteer...');
      userDataDir = path.join(
        process.cwd(),
        'tmp',
        `puppeteer_user_data_${uuidv4()}`,
      );
      await fs.mkdir(userDataDir, { recursive: true });
      this.logger.log(`Usando userDataDir: ${userDataDir}`);

      browser = await puppeteer.launch({
        headless: true,
        timeout: 60000, // Aumentar timeout de lanzamiento
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
        ],
        userDataDir: userDataDir,
      });

      const page = await browser.newPage();

      // Técnicas anti-detección mejoradas
      await page.evaluateOnNewDocument(() => {
        // Sobrescribir la propiedad webdriver
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
        });

        // Sobrescribir la propiedad de plugins
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });

        // Sobrescribir la propiedad de languages
        Object.defineProperty(navigator, 'languages', {
          get: () => ['es-ES', 'es', 'en-US', 'en'],
        });

        // Agregar propiedades de Chrome
        (window as any).chrome = {
          runtime: {},
        };

        // Sobrescribir permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters: any) =>
          parameters.name === 'notifications'
            ? Promise.resolve({
                state: Notification.permission,
              } as PermissionStatus)
            : originalQuery(parameters);
      });

      // User agent más actualizado
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      );
      await page.setViewport({ width: 1920, height: 1080 });

      // Headers adicionales
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        Connection: 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
      });

      this.logger.log(`Navegando a: ${this.url}`);
      await page.goto(this.url, {
        waitUntil: 'domcontentloaded',
        timeout: 90000,
      });

      // Esperar un poco para que cargue JavaScript
      await new Promise((r) => setTimeout(r, 5000));

      try {
        this.logger.log('Buscando banner de cookies para aceptar...');
        const cookieButtonSelector = 'button.cmplz-btn.cmplz-accept';
        const cookieButton = await page.$(cookieButtonSelector);
        if (cookieButton) {
          await Promise.all([
            cookieButton.click(),
            page
              .waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 })
              .catch(() => {}),
          ]);
          this.logger.log('Banner de cookies aceptado. Esperando...');
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          this.logger.log('No se encontró banner de cookies.');
        }
      } catch (e) {
        this.logger.log(
          'No se pudo manejar el banner de cookies. Continuando...',
        );
      }

      // Esperar a que la página esté completamente cargada
      await new Promise((r) => setTimeout(r, 2000));

      // Guardado condicional de archivos de depuración
      const SAVE_DEBUG_FILES = process.env.PUPPETEER_DEBUG_FILES === 'true';

      if (SAVE_DEBUG_FILES) {
        const screenshotPath = path.join(
          process.cwd(),
          'data',
          'debug_screenshot.png',
        );
        await page.screenshot({ path: screenshotPath, fullPage: true });
        this.logger.log(
          `Screenshot para depuración guardado en: ${screenshotPath}`,
        );
      }
      
      const content = await page.content();

      // Guardar el HTML para depuración
      if (SAVE_DEBUG_FILES) {
        const htmlPath = path.join(process.cwd(), 'data', 'debug_page.html');
        await fs.writeFile(htmlPath, content, 'utf-8');
        this.logger.log(
          `HTML de la página guardado para depuración en: ${htmlPath}`,
        );
      }

      // Verificar si hay mensajes de bloqueo
      if (
        content.includes('Access Denied') ||
        content.includes('Acceso Denegado') ||
        content.includes('blocked')
      ) {
        this.logger.error(
          '⚠️ La página parece estar bloqueada por protección anti-bot',
        );
        this.logger.error(
          'Contenido detectado en la página que indica bloqueo',
        );
      }

      this.logger.log(
        'Buscando la tabla en el HTML con Cheerio (heurística)...',
      );
      const rankings: EscalafonEntry[] = [];

      const $ = cheerio.load(content);

      // Selectores candidatos (tablas reales o estructuras con role="table")
      const candidateSelectors = [
        'table',
        'table.listadoTabla', // Selector específico para la tabla del escalafón
        'table#sorter', // ID de la tabla en la página
        'div[role="table"]',
        '.tablalistado',
        '.table-responsive table',
        '.wp-block-table table',
        'section table',
      ];

      let chosenElement: any = null;

      const headerKeywords =
        /posici|posición|posición|posicion|torero|lidiador|festejos|orejas|rabos/i;

      for (const sel of candidateSelectors) {
        const elems = $(sel).toArray();
        this.logger.log(
          `Probando ${elems.length} elementos con selector '${sel}'`,
        );
        for (const el of elems) {
          const text = $(el).text();
          if (headerKeywords.test(text)) {
            chosenElement = el;
            this.logger.log(`✓ Elemento seleccionado con selector '${sel}'`);
            break;
          }
        }
        if (chosenElement) break;
      }

      // Si no encontramos por encabezados, tomar la primera tabla con filas
      if (!chosenElement) {
        const tables = $('table').toArray();
        for (const t of tables) {
          const rows = $(t).find('tbody tr');
          if (rows.length > 0) {
            chosenElement = t;
            this.logger.log(
              'Se seleccionó la primera <table> con filas como fallback.',
            );
            break;
          }
        }
      }

      if (!chosenElement) {
        this.logger.error(
          'No se encontró ningún elemento de tabla válido en el HTML.',
        );
        this.logger.error(
          'Revisa el archivo data/debug_page.html para ver el DOM actual.',
        );
        throw new Error(
          'No se pudo encontrar la tabla de escalafón después de varios intentos.',
        );
      }

      // Obtener filas dependiendo del tipo de elemento
      let rows: any = $(chosenElement).find('tbody tr');
      if (rows.length === 0) {
        // Puede ser que la tabla no tenga <tbody> o esté construida con divs
        rows = $(chosenElement).find('tr');
      }
      if (rows.length === 0) {
        // Estructura basada en divs (role=table / role=row)
        rows = $(chosenElement)
          .find('[role="row"]')
          .filter((i, el) => $(el).find('[role="cell"]').length > 0);
      }

      const totalRows = rows.length;
      this.logger.log(`Total de filas detectadas: ${totalRows}`);

      if (totalRows === 0) {
        this.logger.warn(
          'No se encontraron filas en el elemento de tabla detectado.',
        );
      }

      rows.each((index, element) => {
        const row = $(element);
        // Intentar obtener celdas <td>
        let cells = row.find('td');
        if (cells.length === 0) {
          // Si no hay <td>, buscar elementos con role=cell o divs directos
          cells = row.find('[role="cell"]');
          if (cells.length === 0) {
            cells = row.children('div, span');
          }
        }

        const positionText = cells.eq(0).text().trim();
        const nombreCompleto = cells.eq(1).text().trim();

        const parseNum = (s: string) => {
          const n = s.replace(/[^0-9\-]/g, '');
          return n === '' ? 0 : parseInt(n, 10);
        };

        // En la tabla de mundotoro la estructura es:
        // 0: No., 1: Lidiador, 2: Festejo, 3: Oreja, 4: Rabo,
        // 5-7: Festejos por tipo, 8-10: Orejas por tipo, 11: Reses lidiadas
        const festejosTotal =
          parseNum(cells.eq(5).text()) +
          parseNum(cells.eq(6).text()) +
          parseNum(cells.eq(7).text());
        const orejasTotal =
          parseNum(cells.eq(8).text()) +
          parseNum(cells.eq(9).text()) +
          parseNum(cells.eq(10).text());
        const rabos = parseNum(cells.eq(4).text());

        if (
          positionText &&
          nombreCompleto &&
          !isNaN(parseInt(positionText, 10))
        ) {
          rankings.push({
            posicion: positionText,
            lidiador: nombreCompleto,
            festejos: String(festejosTotal),
            orejas: String(orejasTotal),
            rabos: String(rabos),
          });
        }
      });

      this.logger.log(
        `✓ Scraping con Puppeteer finalizado. Se encontraron ${rankings.length} registros.`,
      );

      if (rankings.length === 0) {
        this.logger.warn(
          '⚠️ ADVERTENCIA: No se encontraron registros. Revisa el HTML guardado en debug_page.html',
        );
      }

      await fs.writeFile(
        this.dataPath,
        JSON.stringify(rankings, null, 2),
        'utf-8',
      );
      this.logger.log(`Cache de escalafón guardado en ${this.dataPath}`);

      return rankings;
    } catch (error) {
      this.logger.error(
        `Error fatal durante el scraping con Puppeteer: ${error.message}`,
      );
      this.logger.error(`Stack trace: ${error.stack}`);
      await fs
        .writeFile(this.dataPath, JSON.stringify([], null, 2), 'utf-8')
        .catch((err) => {
          this.logger.error(
            `No se pudo escribir el archivo de caché vacío: ${err.message}`,
          );
        });
      return [];
    } finally {
      if (browser) {
        this.logger.log('Cerrando instancia de Puppeteer.');
        await browser.close();
      }
      if (userDataDir) {
        try {
          await fs.rm(userDataDir, { recursive: true, force: true });
          this.logger.log(
            `Directorio temporal userDataDir eliminado: ${userDataDir}`,
          );
        } catch (cleanError) {
          this.logger.error(`Error al limpiar userDataDir: ${cleanError}`);
        }
      }
    }
  }
}
