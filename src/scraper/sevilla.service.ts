import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { parseSpanishDate } from '../utils/telegram-format';

export interface SevillaEvent {
  fecha: string;
  descripcion: string;
  ganaderia?: string;
  toreros?: string[];
  hora?: string;
}

@Injectable()
export class SevillaService {
  private readonly logger = new Logger(SevillaService.name);
  private readonly dataPath: string;
  private events: SevillaEvent[] | null = null;

  constructor() {
    this.dataPath = path.join(process.cwd(), 'data', 'sevilla-events.json');
  }

  private async ensureDataLoaded(): Promise<void> {
    if (this.events === null) {
      await this.loadEvents();
    }
  }

  private async loadEvents(): Promise<void> {
    try {
      const fileContent = await fs.readFile(this.dataPath, 'utf-8');
      const data = JSON.parse(fileContent);

      if (Array.isArray(data)) {
        this.events = data;
      } else {
        // Si el JSON es un objeto (ej: { "Sevilla": [...] }), extraemos los arrays de valores
        this.events = Object.values(data).flat() as SevillaEvent[];
      }
      this.logger.log(`Datos de Sevilla cargados desde ${this.dataPath}.`);
    } catch (error) {
      this.logger.error(
        `Error al leer el archivo de eventos de Sevilla (${this.dataPath}): ${error.message}`,
      );
      this.events = [];
    }
  }

  async getEvents(): Promise<SevillaEvent[]> {
    await this.ensureDataLoaded();
    return this.events || [];
  }

  async getUpcomingEvents(): Promise<SevillaEvent[]> {
    const events = await this.getEvents();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return events.filter((event) => {
      const eventDate = parseSpanishDate(event.fecha);
      // Si no se puede parsear la fecha, lo incluimos por si acaso (ej: "Por confirmar")
      if (!eventDate) return true;
      return eventDate >= today;
    });
  }
}
