import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { VentasService } from '../src/scraper/ventas.service';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  process.env.IS_SCRIPT_MODE = 'true'; // Para evitar que se inicien los Cron Jobs o el bot de verdad
  const app = await NestFactory.createApplicationContext(AppModule);
  const ventasService = app.get(VentasService);

  console.log('--- Iniciando prueba de VentasService (Madrid) ---');
  
  try {
    // 1. Forzamos la actualización del archivo JSON
    console.log('1. Forzando actualización del archivo JSON...');
    await ventasService.refreshMadridEvents();
    
    // 2. Verificamos si el archivo se creó
    const filePath = path.join(process.cwd(), 'data', 'madrid-events.json');
    if (fs.existsSync(filePath)) {
      console.log('✅ ÉXITO: El archivo data/madrid-events.json se ha creado correctamente.');
      const data = fs.readFileSync(filePath, 'utf8');
      const events = JSON.parse(data);
      console.log(`🔍 Se han encontrado ${events.length} eventos en Madrid.`);
      
      if (events.length > 0) {
        console.log('--- Muestra del primer evento ---');
        console.log(JSON.stringify(events[0], null, 2));
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
