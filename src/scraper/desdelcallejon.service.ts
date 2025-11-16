import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';

export interface Cronica {
  titulo: string;
  enlace: string;
  extracto: string;
}

@Injectable()
export class DesdelcallejonService {
  private readonly logger = new Logger(DesdelcallejonService.name);
  private readonly TARGET_URL =
    'https://desdelcallejon.com/cronicas-de-festejos/';
  private cachedCronicas: Cronica[] | null = null;
  private lastFetched: Date | null = null;

  async getCronicas(): Promise<Cronica[]> {
    const now = new Date();
    // Cache de 30 minutos para noticias
    const cacheDuration = 30 * 60 * 1000;

    if (
      this.cachedCronicas &&
      this.lastFetched &&
      now.getTime() - this.lastFetched.getTime() < cacheDuration
    ) {
      this.logger.log('Usando caché de crónicas de Desde el Callejón');
      return this.cachedCronicas;
    }

    this.logger.log(`Iniciando scraping de ${this.TARGET_URL}`);
    try {
      const { data } = await axios.get(this.TARGET_URL);
      const $ = cheerio.load(data);
      const cronicas: Cronica[] = [];

      $('article.elementor-post').each((_, element) => {
        const tituloAnchor = $(element).find('h3.elementor-post__title a');
        const extractoParrafo = $(element).find(
          'div.elementor-post__excerpt p',
        );

        if (tituloAnchor.length && extractoParrafo.length) {
          const titulo = tituloAnchor.text().trim();
          const enlace = tituloAnchor.attr('href');
          const extracto = extractoParrafo.text().trim();

          if (titulo && enlace) {
            cronicas.push({
              titulo,
              enlace,
              extracto,
            });
          }
        }
      });

      this.logger.log(`Crónicas encontradas: ${cronicas.length}`);
      this.cachedCronicas = cronicas;
      this.lastFetched = now;
      return cronicas;
    } catch (error) {
      this.logger.error('Error durante el scraping de crónicas', error.stack);
      throw new Error('Falló la extracción de datos de las crónicas.');
    }
  }

  clearCache(): void {
    this.cachedCronicas = null;
    this.lastFetched = null;
    this.logger.log('Caché de crónicas de Desde el Callejón invalidada.');
  }
}
