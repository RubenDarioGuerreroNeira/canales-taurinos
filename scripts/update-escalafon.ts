import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { MundotoroEscalafonService } from '../src/scraper/mundotoroEscalafon.service';
import { INestApplicationContext } from '@nestjs/common';

/**
 * Script independiente para ejecutar el scraping del escalafón a demanda.
 * Este script arranca el contexto de la aplicación NestJS para poder
 * utilizar el servicio `MundotoroEscalafonService` con todas sus dependencias.
 */
async function run() {
  let app: INestApplicationContext | null = null;
  try {
    console.log('🚀 Iniciando el script de actualización del escalafón...');
    app = await NestFactory.createApplicationContext(AppModule);

    const escalafonService = app.get(MundotoroEscalafonService);

    console.log('▶️ Ejecutando el método scrapeAndCache()...');
    await escalafonService['scrapeAndCache'](); // Usamos acceso por string para llamar al método privado

    console.log('✅ ¡Éxito! El archivo escalafon.json ha sido actualizado.');
  } catch (error) {
    console.error('❌ Error durante la ejecución del script:', error);
  } finally {
    await app?.close();
    console.log('🏁 Script finalizado.');
  }
}

run();
