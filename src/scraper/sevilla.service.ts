import { Injectable, Logger } from '@nestjs/common';
import { BaseJsonDataService } from './base-json-data.service';
import { parseSpanishDate } from '../utils/telegram-format';

export interface SevillaEvent {
  fecha: string;
  descripcion: string;
  ganaderia?: string;
  toreros?: string[];
  hora?: string;
}

@Injectable()
export class SevillaService extends BaseJsonDataService<SevillaEvent[]> {
  protected readonly logger = new Logger(SevillaService.name);

  constructor() {
    super('sevilla-events.json');
  }

  protected getDefaultData(): SevillaEvent[] {
    return [];
  }

  async getEvents(): Promise<SevillaEvent[]> {
    return this.ensureDataLoaded();
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
