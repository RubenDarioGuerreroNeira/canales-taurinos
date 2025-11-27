// scripts/update-servitoro.ts

import { Logger } from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer';
import chromium from 'chromium';
import * as cheerio from 'cheerio';
import * as fs from 'fs/promises';
import * as path from 'path';

// Creamos un logger simple para el script
const logger = new Logger('UpdateServitoroScript');
(Logger as any).overrideLogger(console);

// La interfaz de los eventos
interface ServitoroEvent {
  fecha: string;
  ciudad: string;
  nombreEvento: string;
  categoria: string;
  location: string;
  link: string | null;
}

/**
 * Esta función contiene toda la lógica de scraping con Puppeteer.
 * Es una versión autónoma de lo que antes estaba en el ServitoroService.
 */
async function scrapeAllEvents(): Promise<ServitoroEvent[]> {
  const url = 'https://www.servitoro.com/es/calendario-taurino';
  logger.log(`Iniciando scraping de ${url} con Puppeteer...`);
  
  let browser: Browser | null = null;
  let page: import('puppeteer').Page | null = null;

  try {
    logger.log('Lanzando instancia del navegador...');
    const isRender = !!process.env.RENDER;
    browser = await puppeteer.launch({
      executablePath: isRender ? chromium.path : undefined,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.waitForSelector('.card.evento', { timeout: 30000 });

    logger.log('Página cargada. Verificando si hay un botón "Ver más"...');
    while (true) {
      const eventCount = (await page.$$('.card.evento')).length;
      logger.log(`Eventos en página actualmente: ${eventCount}`);

      const loadMoreButton = await page.$('xpath/.//a[contains(., "Ver más")]');

      if (loadMoreButton) {
        logger.log('Botón "Ver más" encontrado, haciendo clic...');
        await loadMoreButton.click();
        try {
          await page.waitForFunction(
            (selector, count) => document.querySelectorAll(selector).length > count,
            { timeout: 15000 },
            '.card.evento',
            eventCount,
          );
        } catch (timeoutError) {
          logger.log('Timeout esperando nuevos eventos. Se asume que todos han sido cargados.');
          break;
        }
      } else {
        logger.log('No se encontró el botón "Ver más". Se asume que todos los eventos están cargados.');
        break;
      }
    }

    logger.log('Extrayendo HTML final...');
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

    logger.log(`Scraping finalizado. Total de eventos encontrados: ${eventos.length}`);
    return eventos;

  } catch (error) {
    logger.error('El scraping falló.', error.stack);
    return [];
  } finally {
    if (page) await page.close();
    if (browser) await browser.close();
    logger.log('Navegador cerrado.');
  }
}

/**
 * Función principal del script.
 * Ejecuta el scraping y guarda los resultados en el archivo JSON.
 */
async function main() {
  logger.log('--- INICIANDO SCRIPT DE ACTUALIZACIÓN DE SERVIDORO ---');
  
  const eventos = await scrapeAllEvents();

  if (eventos && eventos.length > 0) {
    const dataDir = path.join(process.cwd(), 'data');
    const filePath = path.join(dataDir, 'servitoro-events.json');

    try {
      // Asegurarse de que el directorio 'data' existe
      await fs.mkdir(dataDir, { recursive: true });
      
      // Guardar los datos en el archivo JSON
      await fs.writeFile(filePath, JSON.stringify(eventos, null, 2));
      logger.log(`¡Éxito! Archivo de datos actualizado correctamente en: ${filePath}`);
    } catch (error) {
      logger.error(`Error al guardar el archivo de datos.`, error.stack);
    }
  } else {
    logger.warn('El scraping no devolvió eventos. El archivo de datos no fue actualizado.');
  }

  logger.log('--- SCRIPT DE ACTUALIZACIÓN DE SERVIDORO FINALIZADO ---');
}

// Ejecutar la función principal
main();
