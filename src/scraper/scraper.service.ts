import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as cheerio from 'cheerio';

export interface Transmision {
  fecha: string;
  descripcion: string;
  enlaces: { texto: string; url: string }[];
}


@Injectable()
export class ScraperService {
  private readonly url =
    'https://elmuletazo.com/agenda-de-toros-en-television/';
  private cachedTransmisiones: Transmision[] | null = null;
  private lastFetched: Date | null = null;

  async scrapeTransmisiones(): Promise<Transmision[]> {
    const now = new Date();
    // Cache de 1 hora
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    if (
      this.cachedTransmisiones &&
      this.lastFetched &&
      this.lastFetched > oneHourAgo
    ) {
      console.log('ScraperService: Usando caché de transmisiones');
      return this.cachedTransmisiones;
    }

    console.log(
      'ScraperService: Realizando scraping nuevo desde El Muletazo...',
    );
    const data = await this.fetchAndParse();
    this.cachedTransmisiones = data;
    this.lastFetched = now;
    return data;
  }

  clearCache(): void {
    this.cachedTransmisiones = null;
    this.lastFetched = null;
    console.log('ScraperService: Caché invalidada manualmente.');
  }

  private async fetchAndParse(): Promise<Transmision[]> {
    const { data } = await axios.get(this.url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });

    const $ = cheerio.load(data);
    const eventos: Transmision[] = [];

    // Usamos el selector que has identificado, que apunta a los párrafos con la descripción.
    const posibles = $('p.has-text-align-justify');
    posibles.each((_, element) => {
      const p = $(element);
      const pText = p.text().trim();

      // Patrones para encontrar la fecha dentro del texto del párrafo.
      const patrones = [
        /((Lunes|Martes|Mi[eé]rcoles|Jueves|Viernes|S[aá]bado|Domingo) \d{1,2} de \w+ de \d{4})/i,
        /(\d{1,2}\/\d{1,2}\/\d{2,4})/,
        /(\d{1,2} de \w+ de \d{4})/i,
      ];

      let fecha = 'Fecha no especificada';
      for (const pat of patrones) {
        const m = pText.match(pat);
        if (m) {
          fecha = m[1];
          break;
        }
      }

      // La descripción es el texto del párrafo sin la fecha.
      const descripcion = pText.replace(fecha, '').replace(/\s+/g, ' ').trim();

      // Extraer enlaces del párrafo actual y del siguiente (que a menudo contiene el link "PULSE AQUÍ").
      const enlaces: { texto: string; url: string }[] = [];
      const elementosConEnlaces = p.add(p.next('p')); // Combina el p actual con el siguiente

      elementosConEnlaces.find('a').each((_, link) => {
        const url = $(link).attr('href') || '';
        const texto = $(link).text().trim() || url;
        const resolved = this.resolveUrl(url);
        // Evitar duplicados
        if (resolved && !enlaces.some((e) => e.url === resolved)) {
          enlaces.push({ texto, url: resolved });
        }
      });

      // Al menos uno de fecha o enlaces o descripción debe ser significativo
      if (
        fecha === 'Fecha no especificada' &&
        enlaces.length === 0 &&
        descripcion.length < 10
      )
        return;

      // Log para depuración
      console.log('ScraperService: bloque detectado ->', {
        fecha,
        descripcion: descripcion.substring(0, 50) + '...',
        enlacesCount: enlaces.length,
      });

      eventos.push({
        fecha,
        descripcion: descripcion || 'Descripción no disponible',
        enlaces,
      });
    });

    return eventos;
  }

  // Resuelve URLs relativas basadas en la página objetivo y valida esquema http(s)
  private resolveUrl(url: string): string | null {
    if (!url) return null;
    url = url.trim();
    try {
      // Si ya es absoluta
      if (/^https?:\/\//i.test(url)) return url;

      // Si es protocolo relativo
      if (url.startsWith('//')) return `https:${url}`;

      // Si es ruta relativa, construir a partir del host base
      const base = new URL(this.url);
      const resolved = new URL(url, base).toString();
      if (/^https?:\/\//i.test(resolved)) return resolved;
      return null;
    } catch (err) {
      console.warn('ScraperService: URL inválida detectada ->', url);
      return null;
    }
  }
}
