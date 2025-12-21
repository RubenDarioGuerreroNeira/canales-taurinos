export function escapeMarkdownV2(text: string): string {
  if (!text) return '';
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

export function escapeMarkdownUrl(url: string): string {
  if (!url) return '';
  return url.replace(/[()\\]/g, '\\$&');
}

export function parseSpanishDate(dateStr: string): Date | null {
  // Ejemplo 1: "Viernes 26 de diciembre de 2025" o "Viernes 26 de diciembre de 2025, 3:30 p.m"
  // Ejemplo 2: "01/01/2026 00:00"
  try {
    const months: { [key: string]: number } = {
      'enero': 0, 'febrero': 1, 'marzo': 2, 'abril': 3, 'mayo': 4, 'junio': 5,
      'julio': 6, 'agosto': 7, 'septiembre': 8, 'octubre': 9, 'noviembre': 10, 'diciembre': 11
    };

    // Intentar formato "DD de MES de YYYY"
    const matchText = dateStr.toLowerCase().match(/(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})/);
    if (matchText) {
      const day = parseInt(matchText[1], 10);
      const monthName = matchText[2];
      const year = parseInt(matchText[3], 10);
      if (months[monthName] !== undefined) {
        return new Date(year, months[monthName], day, 12, 0, 0);
      }
    }

    // Intentar formato "DD/MM/YYYY" (con opcional hora al final)
    const matchSlash = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (matchSlash) {
      const day = parseInt(matchSlash[1], 10);
      const month = parseInt(matchSlash[2], 10) - 1;
      const year = parseInt(matchSlash[3], 10);
      return new Date(year, month, day, 12, 0, 0);
    }

    return null;
  } catch (e) {
    console.error('Error parsing date:', dateStr, e);
    return null;
  }
}