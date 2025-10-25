import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TelegramService } from './telegram/telegram.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const telegramService = app.get(TelegramService);

  // Habilita los ganchos de apagado para asegurar que onModuleDestroy se llame
  // durante la recarga en caliente, cerrando Puppeteer correctamente.
  app.enableShutdownHooks();

  // Configuración para Webhooks en lugar de Polling
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    // En producción (Render), usamos el middleware de webhook
    const webhookMiddleware = await telegramService.getWebhookMiddleware();
    app.use(webhookMiddleware);

    // Obtenemos la URL de Render y configuramos el webhook en Telegram
    const renderExternalUrl = process.env.RENDER_EXTERNAL_URL;
    const webhookUrl = `${renderExternalUrl}/api/telegram`;
    await telegramService.getBot().telegram.setWebhook(webhookUrl);
    console.log(`Webhook configurado en: ${webhookUrl}`);
  } else {
    // En desarrollo, usamos long-polling.
    // Esto es mucho más sencillo para el entorno local.
    telegramService.getBot().launch();
    console.log(
      '🤖 Bot de Telegram iniciado con long polling para desarrollo...',
    );
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
}
bootstrap();
