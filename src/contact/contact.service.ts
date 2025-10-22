import { Injectable } from '@nestjs/common';

@Injectable()
export class ContactService {
  private readonly contactInfo = {
    telegram: '@Rubedev',
    whatsapp: ['+573207710450', '+584160897020'],
    email: 'rudargeneira@gmail.com',
  };

  getContactMessage(): string {
    // Genera los enlaces de WhatsApp en formato MarkdownV2: [texto](url)
    const whatsappLinks = this.contactInfo.whatsapp
      .map((num) => {
        const cleanNum = num.replace(/[\s+]/g, ''); // Ej: 573207710450
        const escapedText = this.escapeMarkdown(num); // Escapa el texto visible: \+57 3207710450
        return `${escapedText}`; // Crea el enlace MarkdownV2
      })
      .join(' / ');

    // Escapamos las partes variables para evitar conflictos con MarkdownV2
    const telegramUser = this.escapeMarkdown(this.contactInfo.telegram);
    const email = this.escapeMarkdown(this.contactInfo.email);

    // Construimos el mensaje final con el formato correcto y los enlaces
    return this.escapeMarkdown(
      '¡Me encantaría escuchar tus ideas y sugerencias para mejorar este bot!',
    )
      .concat('\n\n')
      .concat(
        this.escapeMarkdown(
          'Puedes contactarme a través de los siguientes medios:',
        ),
      )
      .concat(`\n\n\\- *Telegram:* ${telegramUser}`) // Escapamos el guion
      .concat(`\n\\- *WhatsApp:* ${whatsappLinks}`) // Escapamos el guion
      .concat(`\n\\- *Email:* ${email}\n\n`) // Escapamos el guion
      .concat(
        this.escapeMarkdown(
          '¡Espero tu mensaje! Tu feedback es muy valioso para hacer de este un mejor asistente.',
        ),
      );
  }

  // Método para escapar caracteres especiales para MarkdownV2
  private escapeMarkdown(text: string): string {
    if (!text) return '';
    // Escapa los caracteres que Telegram considera especiales en MarkdownV2
    return text.replace(/([_*\\~`>#+\-=|{}.!])/g, '\\$1');
  }
}
