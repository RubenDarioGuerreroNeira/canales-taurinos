import { Injectable, Logger } from '@nestjs/common';
import { BaseJsonDataService } from './base-json-data.service';
import { parseSpanishDate } from '../utils/telegram-format';

interface AmericaEvent {
  fecha: string;
  ganaderia: string;
  toreros: string[];
  descripcion?: string;
}

interface AmericaEventsData {
  [city: string]: AmericaEvent[];
}

@Injectable()
export class AmericaEventsService extends BaseJsonDataService<AmericaEventsData> {
  protected readonly logger = new Logger(AmericaEventsService.name);

  constructor() {
    super('america-events.json');
  }

  protected getDefaultData(): AmericaEventsData {
    return {};
  }

  async getAvailableCities(): Promise<string[]> {
    const data = await this.ensureDataLoaded();
    return Object.keys(data);
  }

  async getCitiesWithUpcomingEvents(): Promise<string[]> {
    const data = await this.ensureDataLoaded();
    const cities = Object.keys(data);
    const citiesWithEvents: string[] = [];

    for (const city of cities) {
      const upcomingEvents = await this.getUpcomingEventsForCity(city);
      if (upcomingEvents && upcomingEvents.length > 0) {
        citiesWithEvents.push(city);
      }
    }

    return citiesWithEvents;
  }

  async getUpcomingEventsForCity(city: string): Promise<AmericaEvent[] | null> {
    const events = await this.getEventsForCity(city);
    if (!events) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return events.filter((event) => {
      const eventDate = parseSpanishDate(event.fecha);
      return eventDate ? eventDate >= today : false;
    });
  }

  async getEventsForCity(city: string): Promise<AmericaEvent[] | null> {
    const data = await this.ensureDataLoaded();
    const normalizedCity = city.toLowerCase();
    const foundCityKey = Object.keys(data).find((key) =>
      key.toLowerCase().includes(normalizedCity),
    );
    return foundCityKey ? data[foundCityKey] : null;
  }
}
