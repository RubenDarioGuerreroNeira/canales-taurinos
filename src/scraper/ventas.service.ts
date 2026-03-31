import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PuppeteerService } from './puppeteer.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';

export interface VentasEvent {
  fecha: string;
  hora: string;
  descripcion: string;
  ganaderia?: string;
  toreros: string[];
}

@Injectable()
export class VentasService implements OnModuleInit {
  private readonly logger = new Logger(VentasService.name);
  private readonly url = 'https://www.las-ventas.com/actualidad/proximos-festejos-plaza-toros-las-ventas';
  private readonly filePath = path.join(process.cwd(), 'data', 'madrid-events.json');

  constructor(private readonly puppeteerService: PuppeteerService) {}

  async onModuleInit() {
    // Si el archivo no existe al iniciar, hacemos un scraping inicial
    if (!fs.existsSync(this.filePath)) {
      this.logger.log('Archivo de eventos de Madrid no encontrado. Iniciando scraping inicial...');
      await this.refreshMadridEvents();
    }
  }

  /**
   * Cron job que se ejecuta cada domingo a las 03:00 AM
   */
  @Cron('0 3 * * 0')
  async handleCron() {
    this.logger.log('Ejecutando Cron Job programado: Actualizando eventos de Madrid...');
    await this.refreshMadridEvents();
  }

  /**
   * Realiza el scraping y actualiza el archivo JSON
   */
  async refreshMadridEvents(): Promise<void> {
    this.logger.log('Iniciando scraping de Las Ventas para actualización de JSON...');
    try {
      const html = await this.puppeteerService.getPageContent(this.url);
      const $ = cheerio.load(html);
      const events: VentasEvent[] = [];

      const container = $('.text-new');
      
      container.find('p').each((_, element) => {
        const pText = $(element).html() || '';
        const parts = pText.split(/<br\s*\/?>/i);

        parts.forEach(part => {
          const $part = cheerio.load(`<span>${part}</span>`)('span');
          const fullText = $part.text().trim();

          if (!fullText || fullText.length < 10) return;

          const fecha = $part.find('strong').first().text().trim();
          if (!fecha || !/lunes|martes|miércoles|jueves|viernes|sábado|domingo/i.test(fecha)) return;

          const horaMatch = fullText.match(/(\d{1,2}(?::\d{2})?h)/i);
          const hora = horaMatch ? horaMatch[1] : '';

          const ganaderiaMatch = fullText.match(/(?:Toros|Novillos)\s+de\s+(.+?)\s+para\b/i);
          let ganaderia = ganaderiaMatch ? ganaderiaMatch[1].trim() : '';
          
          if (!ganaderia) {
            const altMatch = fullText.match(/(?:Toros|Novillos)\s+de\s+([^.]+)/i);
            ganaderia = altMatch ? altMatch[1].trim() : '';
          }

          ganaderia = ganaderia.replace(/[.,]$/, '').trim();

          const toreros: string[] = [];
          const dateWords = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre', 'domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'ramos', 'resurrección', 'palmas'];

          $part.find('strong').each((i, el) => {
            const name = $(el).text().trim();
            if (!name || name.length <= 3) return;
            if (i === 0 && /lunes|martes|miércoles|jueves|viernes|sábado|domingo/i.test(name)) return;
            const isDateInfo = dateWords.some(word => name.toLowerCase().includes(word));
            if (isDateInfo) return;

            // Filtro para evitar que la descripción o ganadería se cuelen como torero
            const lowerName = name.toLowerCase();
            const lowerGanaderia = ganaderia.toLowerCase();
            const lowerDesc = (this.extractDescripcion(fullText) || '').toLowerCase();

            if (lowerGanaderia.includes(lowerName) || lowerName.includes(lowerGanaderia)) return;
            if (lowerDesc.includes(lowerName) || lowerName.includes(lowerDesc)) return;
            if (lowerName.includes('corrida') || lowerName.includes('festejo')) return;

            toreros.push(name);
          });

          if (toreros.length === 0) {
            const paraIndex = fullText.toLowerCase().indexOf(' para ');
            if (paraIndex !== -1) {
              const torerosText = fullText.substring(paraIndex + 6).split('.')[0];
              torerosText.split(/,|y/).forEach(t => {
                const cleanT = t.trim();
                const isDateInfo = dateWords.some(word => cleanT.toLowerCase().includes(word));
                if (cleanT && cleanT.length > 3 && !isDateInfo) {
                  const lowerT = cleanT.toLowerCase();
                  const lowerGanaderia = ganaderia.toLowerCase();
                  const lowerDesc = (this.extractDescripcion(fullText) || '').toLowerCase();
                  
                  if (!lowerGanaderia.includes(lowerT) && !lowerDesc.includes(lowerT)) {
                    toreros.push(cleanT);
                  }
                }
              });
            }
          }

          events.push({
            fecha,
            hora,
            ganaderia: ganaderia || 'Por designar',
            toreros,
            descripcion: this.extractDescripcion(fullText)
          });
        });
      });

      // Guardar en el archivo JSON
      const dataDir = path.dirname(this.filePath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(events, null, 2), 'utf8');

      this.logger.log(`Archivo JSON actualizado exitosamente con ${events.length} eventos.`);
    } catch (error) {
      this.logger.error('Error actualizando el archivo de eventos de Madrid', error.stack);
    }
  }

  /**
   * Extrae la descripción de forma más inteligente para casos como Beneficencia o In Memoriam
   */
  private extractDescripcion(text: string): string {
    if (text.toLowerCase().includes('beneficencia')) return 'Corrida de Beneficencia';
    if (text.toLowerCase().includes('memoriam')) {
      const match = text.match(/Corrida\s+In\s+Memoriam\s+de\s+[^.]+/i);
      return match ? match[0] : 'Corrida In Memoriam';
    }
    if (text.toLowerCase().includes('novillada')) return 'Novillada con picadores';
    if (text.toLowerCase().includes('rejones')) return 'Corrida de rejones';
    
    // Si no hay palabras clave, intentamos sacar lo que hay entre la hora y la ganadería
    const parts = text.split('.');
    if (parts.length > 2) {
      const descCandidate = parts[2].trim();
      if (descCandidate && descCandidate.length > 5 && !descCandidate.toLowerCase().includes('toros de')) {
        return descCandidate;
      }
    }
    
    return 'Corrida de toros';
  }

  /**
   * Retorna los eventos desde el archivo JSON de forma instantánea
   */
  async getEvents(): Promise<VentasEvent[]> {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.logger.warn('El archivo JSON no existe. Intentando scraping de emergencia...');
        await this.refreshMadridEvents();
      }

      const data = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      this.logger.error('Error al leer el archivo JSON de Madrid', error.stack);
      return [];
    }
  }
}
