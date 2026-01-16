import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ContactService {
  constructor(private configService: ConfigService) {}

  getContactMessage(): string {
    const telegram =
      this.configService.get<string>('CONTACT_TELEGRAM') || '@Rubedev';
    const whatsappStr =
      this.configService.get<string>('CONTACT_WHATSAPP') ||
      '+573207710450,+584160897020';
    const email =
      this.configService.get<string>('CONTACT_EMAIL') ||
      'rudargeneira@gmail.com';

    const whatsapp = whatsappStr.split(',').map((num) => num.trim());

    // Genera los enlaces de WhatsApp en formato MarkdownV2: [texto](url)
    const whatsappLinks = whatsapp
      .map((num) => {
        const escapedText = this.escapeMarkdown(num); // Escapa el texto visible: \+57 3207710450
        // Crea el enlace MarkdownV2: texto_escapado
        return `${escapedText}`;
      })
      .join(' / ');

    // Escapamos las partes variables para evitar conflictos con MarkdownV2
    const telegramUser = this.escapeMarkdown(telegram);
    const emailText = this.escapeMarkdown(email); // Escapar solo el texto del email
    const emailLink = `${emailText}`; // Construir el enlace

    // Construimos el mensaje final con el formato correcto y los enlaces
    const message = `

${this.escapeMarkdown('¡A Rubén Guerrero le encantaría escuchar tus ideas y sugerencias para mejorar este bot!')}

${this.escapeMarkdown('Puedes contactarlo a través de los siguientes medios:')}

\\- *Telegram:* ${telegramUser}
\\- *WhatsApp:* ${whatsappLinks}
\\- *Email:* ${emailLink}

${this.escapeMarkdown('¡Espera tu mensaje! Tu feedback es muy valioso para hacer de este un mejor asistente.')}
    `.trim();

    return message; // Retornar el mensaje tal cual, con las partes ya escapadas/formateadas.
  }

  // Método para escapar caracteres especiales para MarkdownV2
  private escapeMarkdown(text: string): string {
    if (!text) return '';
    // Escapa los caracteres que Telegram considera especiales en MarkdownV2
    return text
      .replace(/([_*\\~`>#+\-=|{}.!\\])/g, '\\$1')
      .replace(/\n/g, '\\n');
  }
}
