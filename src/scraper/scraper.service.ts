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

  private async fetchAndParse(): Promise<Transmision[]> {
    const { data } = await axios.get(this.url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    });

    const $ = cheerio.load(data);
    const eventos: Transmision[] = [];

    $('div.entry-content p').each((_, element) => {
      const p = $(element);
      const textoCompleto = p.text().replace(/\s+/g, ' ').trim();

      if (!textoCompleto.includes('➡️') || p.find('a').length === 0) {
        return;
      }

      const dateMatch = textoCompleto.match(
        /^(Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo) \d+ de \w+ de \d+/,
      );
      const fecha = dateMatch ? dateMatch[0] : 'Fecha no especificada';

      const enlaces: { texto: string; url: string }[] = [];
      p.find('a').each((_, link) => {
        const url = $(link).attr('href');
        const texto = $(link).text().trim();
        if (url && url.startsWith('http')) {
          enlaces.push({ texto, url });
        }
      });

      if (enlaces.length === 0) return; // En .each(), 'return' actúa como 'continue'

      const partes = textoCompleto.split('➡️');
      let descripcion =
        partes.length > 1
          ? partes[1].split('(')[0].trim()
          : 'Descripción no disponible';
      descripcion = descripcion
        .replace(/Pulse aquí para ver en directo\./gi, '')
        .trim();

      eventos.push({ fecha, descripcion, enlaces });
    });

    return eventos;
  }
}
