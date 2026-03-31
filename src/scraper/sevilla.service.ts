import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PuppeteerService } from './puppeteer.service';
import { Cron } from '@nestjs/schedule';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';

export interface SevillaEvent {
  fecha: string;
  hora: string;
  descripcion: string;
  ganaderia?: string;
  toreros: string[];
}

@Injectable()
export class SevillaService implements OnModuleInit {
  private readonly logger = new Logger(SevillaService.name);
  private readonly url = 'https://www.diariodesevilla.es/toros/carteles-oficiales-temporada-2026-plaza_0_2005854395.html';
  private readonly filePath = path.join(process.cwd(), 'data', 'sevilla-events.json');

  constructor(private readonly puppeteerService: PuppeteerService) {}

  async onModuleInit() {
    if (!fs.existsSync(this.filePath)) {
      this.logger.log('Archivo de eventos de Sevilla no encontrado. Iniciando scraping inicial...');
      await this.refreshSevillaEvents();
    }
  }

  @Cron('0 3 * * 0')
  async handleCron() {
    this.logger.log('Ejecutando Cron Job programado: Actualizando eventos de Sevilla...');
    await this.refreshSevillaEvents();
  }

  async refreshSevillaEvents(): Promise<void> {
    this.logger.log('Iniciando scraping de Sevilla para actualización de JSON...');
    try {
      const html = await this.puppeteerService.getPageContent(this.url);
      const $ = cheerio.load(html);
      const events: SevillaEvent[] = [];

      // El contenido principal está en .bbnx-body
      $('.bbnx-body p').each((_, element) => {
        const text = $(element).text().trim();
        
        // Buscamos líneas que contengan fechas (ej: "• 11 de abril", "Domingo, 5 de abril")
        // También líneas que empiecen con fecha como "4 de junio"
        const hasDate = text.includes(' de ') && 
                       (text.startsWith('•') || 
                        /^(Domingo|Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|\d{1,2}\s+de)/i.test(text));

        if (!hasDate) return;

        // Limpiar el bullet inicial si existe
        let cleanText = text.replace(/^•\s*/, '').trim();
        
        // Identificar la descripción (si es novillada o rejones)
        let descripcion = 'Corrida de toros';
        if (cleanText.toLowerCase().includes('novillada')) descripcion = 'Novillada con picadores';
        if (cleanText.toLowerCase().includes('rejones')) descripcion = 'Corrida de rejones';
        if (cleanText.toLowerCase().includes('beneficencia')) descripcion = 'Corrida de Beneficencia';
        if (cleanText.toLowerCase().includes('resurrección')) descripcion = 'Domingo de Resurrección';

        // Separar Fecha | Ganadería | Toreros
        // Intentamos encontrar el primer separador tras la fecha (punto o guion largo)
        // Ejemplo 1: "Domingo, 5 de abril. Resurrección Toros de Garcigrande para Morante..."
        // Ejemplo 2: "15 de abril – Santiago Domecq. Miguel Ángel Perera..."
        
        let fecha = '';
        let ganaderia = '';
        let toreros: string[] = [];

        // Regex para extraer la fecha al inicio
        const dateMatch = cleanText.match(/^([^.–\-\n]+ de [^.–\-\n\s]+(?:\s+de\s+\d{4})?)/i);
        if (dateMatch) {
          fecha = dateMatch[1].trim();
          let rest = cleanText.substring(fecha.length).replace(/^[.,–\-\s]+/, '');
          
          // Limpiar la fecha de palabras como "Resurrección" si se colaron
          fecha = fecha.replace(/Resurrección/i, '').trim();

          if (rest.toLowerCase().includes('para')) {
            const paraParts = rest.split(/para/i);
            ganaderia = paraParts[0].replace(/(Toros|Novillos)\s+de\s+/i, '').trim();
            // Limpiar ganadería de descripciones que se queden al inicio (ej: "Resurrección Toros de...")
            ganaderia = ganaderia.replace(/^(Resurrección|Corpus)\s+/i, '').trim();
            
            toreros = paraParts[1].split(/[•,y]/).map(t => t.trim()).filter(t => t.length > 2);
          } else {
            // Caso sin "para": "Santiago Domecq. Miguel Ángel Perera • David Galván"
            const subParts = rest.split(/[.–]/);
            ganaderia = subParts[0].replace(/(Toros|Novillos)\s+de\s+/i, '').trim();
            if (subParts[1]) {
              toreros = subParts[1].split(/[•,y]/).map(t => t.trim()).filter(t => t.length > 2);
            }
          }
        }

        if (fecha && (ganaderia || toreros.length > 0)) {
          events.push({
            fecha: fecha.replace(/^[,\s]+|[,\s]+$/g, ''), // Limpiar comas sueltas
            hora: '18:30h',
            descripcion,
            ganaderia: ganaderia || 'Por designar',
            toreros
          });
        }
      });

      const dataDir = path.dirname(this.filePath);
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(events, null, 2), 'utf8');

      this.logger.log(`Archivo JSON de Sevilla actualizado con ${events.length} eventos.`);
    } catch (error) {
      this.logger.error('Error actualizando eventos de Sevilla', error.stack);
    }
  }

  async getEvents(): Promise<SevillaEvent[]> {
    try {
      if (!fs.existsSync(this.filePath)) await this.refreshSevillaEvents();
      const data = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      this.logger.error('Error leyendo JSON de Sevilla', error.stack);
      return [];
    }
  }
}
