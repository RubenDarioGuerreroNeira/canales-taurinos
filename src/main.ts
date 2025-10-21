import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // La siguiente línea es necesaria para mantener la aplicación viva.
  await app.listen(3000);
}
bootstrap();
