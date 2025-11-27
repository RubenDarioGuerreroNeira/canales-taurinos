import { ScraperService } from '../src/scraper/scraper.service';

(async () => {
  try {
    const s = new ScraperService();
    console.log('Iniciando prueba de scraper...');
    const eventos = await s.scrapeTransmisiones();
    console.log('Eventos extraídos:', JSON.stringify(eventos, null, 2));
    console.log('Total eventos:', eventos.length);
  } catch (err) {
    console.error('Error en test-scraper:', err);
    process.exit(1);
  }
})();
