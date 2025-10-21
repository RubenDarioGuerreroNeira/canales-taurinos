import { Controller, Post, Body } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import type { Update } from 'telegraf/types';

@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  @Post()
  handleUpdate(@Body() update: Update) {
    this.telegramService.getBot().handleUpdate(update);
  }
}
