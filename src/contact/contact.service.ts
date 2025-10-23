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
        const cleanNum = num.replace(/\s/g, ''); // Elimina solo espacios
        const escapedText = this.escapeMarkdown(num); // Escapa el texto visible: \+57 3207710450
        // Crea el enlace MarkdownV2: texto_escapado
        return `${escapedText}`;
      })
      .join(' / ');

    // Escapamos las partes variables para evitar conflictos con MarkdownV2
    const telegramUser = this.escapeMarkdown(this.contactInfo.telegram);
    const emailText = this.escapeMarkdown(this.contactInfo.email); // Escapar solo el texto del email
    const emailLink = `${emailText}`; // Construir el enlace

    // Construimos el mensaje final con el formato correcto y los enlaces
    const message = `
${this.escapeMarkdown('¡Me encantaría escuchar tus ideas y sugerencias para mejorar este bot!')}

${this.escapeMarkdown('Puedes contactarme a través de los siguientes medios:')}

\\- *Telegram:* ${telegramUser}
\\- *WhatsApp:* ${whatsappLinks}
\\- *Email:* ${emailLink}

${this.escapeMarkdown('¡Espero tu mensaje! Tu feedback es muy valioso para hacer de este un mejor asistente.')}
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
