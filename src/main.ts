import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Habilita los ganchos de apagado para asegurar que onModuleDestroy se llame
  // durante la recarga en caliente, cerrando Puppeteer correctamente.
  app.enableShutdownHooks();

  // La siguiente línea es necesaria para mantener la aplicación viva.
  // Usamos el puerto 3000 por defecto y permitimos que sea sobreescrito por una variable de entorno.
  const port = process.env.PORT || 3000;
  await app.listen(port);
}
bootstrap();
