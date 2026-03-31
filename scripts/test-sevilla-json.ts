import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SevillaService } from '../src/scraper/sevilla.service';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  process.env.IS_SCRIPT_MODE = 'true';
  const app = await NestFactory.createApplicationContext(AppModule);
  const sevillaService = app.get(SevillaService);

  console.log('--- Iniciando prueba de SevillaService (La Maestranza) ---');
  
  try {
    // 1. Forzamos la actualización del archivo JSON
    console.log('1. Forzando actualización del archivo JSON...');
    await sevillaService.refreshSevillaEvents();
    
    // 2. Verificamos si el archivo se creó
    const filePath = path.join(process.cwd(), 'data', 'sevilla-events.json');
    if (fs.existsSync(filePath)) {
      console.log('✅ ÉXITO: El archivo data/sevilla-events.json se ha creado.');
      const data = fs.readFileSync(filePath, 'utf8');
      const events = JSON.parse(data);
      console.log(`🔍 Se han encontrado ${events.length} eventos en Sevilla.`);
      
      if (events.length > 0) {
        console.log('--- Muestra del primer evento ---');
        console.log(JSON.stringify(events[0], null, 2));
      } else {
        console.warn('⚠️ El archivo está vacío. El scraping no encontró eventos.');
      }
    } else {
      console.error('❌ ERROR: El archivo JSON no se ha creado.');
    }
  } catch (error) {
    console.error('❌ Error durante la prueba:', error);
  } finally {
    await app.close();
    process.exit(0);
  }
}

bootstrap();
