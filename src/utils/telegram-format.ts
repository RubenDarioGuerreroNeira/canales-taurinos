export function escapeMarkdownV2(text: string): string {
  if (!text) return '';
  return text.replace(/[_*[\]()~`>#+\-=|{}.!}]/g, '\\$&');
}

export function escapeMarkdownUrl(url: string): string {
  if (!url) return '';
  return url.replace(/[()\\]/g, '\\$&');
}

export function parseSpanishDate(dateStr: string): Date | null {
  if (!dateStr) return null;

  try {
    const months: { [key: string]: number } = {
      'enero': 0, 'febrero': 1, 'marzo': 2, 'abril': 3, 'mayo': 4, 'junio': 5,
      'julio': 6, 'agosto': 7, 'septiembre': 8, 'octubre': 9, 'noviembre': 10, 'diciembre': 11
    };

    const cleanStr = dateStr.toLowerCase().trim();

    // 1. Formato "Lunes 26 de diciembre de 2025" o "26 de diciembre de 2025"
    const matchText = cleanStr.match(/(?:\w+\s+)?(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})/i);
    if (matchText) {
      const day = parseInt(matchText[1], 10);
      const monthName = matchText[2];
      const year = parseInt(matchText[3], 10);
      if (months[monthName] !== undefined) {
        return new Date(year, months[monthName], day, 12, 0, 0);
      }
    }

    // 2. Formato "DD/MM/YYYY" o "DD/MM/YY"
    const matchSlash = cleanStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (matchSlash) {
      const day = parseInt(matchSlash[1], 10);
      const month = parseInt(matchSlash[2], 10) - 1;
      let year = parseInt(matchSlash[3], 10);
      if (year < 100) year += 2000; // Asumir 20xx si es YY
      return new Date(year, month, day, 12, 0, 0);
    }

    // 3. Formato "DD-MM-YYYY"
    const matchDash = cleanStr.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (matchDash) {
      const day = parseInt(matchDash[1], 10);
      const month = parseInt(matchDash[2], 10) - 1;
      const year = parseInt(matchDash[3], 10);
      return new Date(year, month, day, 12, 0, 0);
    }

    return null;
  } catch (e) {
    console.error('Error parsing date:', dateStr, e);
    return null;
  }
}