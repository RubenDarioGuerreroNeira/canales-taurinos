import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';

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
export class AmericaEventsService {
  private readonly logger = new Logger(AmericaEventsService.name);
  private readonly dataPath: string;
  private americaEvents: AmericaEventsData | null = null;

  constructor() {
    this.dataPath = path.join(process.cwd(), 'data', 'america-events.json');
    // No llamar a un método async directamente en el constructor.
    // La carga se realizará de forma perezosa cuando se necesite.
  }

  private async ensureDataLoaded(): Promise<void> {
    if (this.americaEvents === null) {
      await this.loadAmericaEvents();
    }
  }

  private async loadAmericaEvents(): Promise<void> {
    try {
      const fileContent = await fs.readFile(this.dataPath, 'utf-8');
      this.americaEvents = JSON.parse(fileContent);
      this.logger.log(
        `Datos de eventos en América cargados desde ${this.dataPath}.`,
      );
    } catch (error) {
      this.logger.error(
        `Error al leer o parsear el archivo de eventos en América (${this.dataPath}): ${error.message}`,
      );
      this.americaEvents = {}; // Inicializar como objeto vacío para evitar errores posteriores
    }
  }

  async getAvailableCities(): Promise<string[]> {
    await this.ensureDataLoaded();
    return Object.keys(this.americaEvents || {});
  }

  async getEventsForCity(city: string): Promise<AmericaEvent[] | null> {
    await this.ensureDataLoaded();

    // Añadimos una guarda de tipo para asegurar a TypeScript que this.americaEvents no es null.
    if (!this.americaEvents) {
      return null;
    }

    const normalizedCity = city.toLowerCase();
    const foundCityKey = Object.keys(this.americaEvents).find((key) =>
      key.toLowerCase().includes(normalizedCity),
    );
    return foundCityKey ? this.americaEvents[foundCityKey] : null; // Ahora this.americaEvents está garantizado como no-null
  }
}
