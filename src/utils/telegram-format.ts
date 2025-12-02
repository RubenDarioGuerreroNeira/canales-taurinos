export function escapeMarkdownV2(text: string): string {
  if (!text) return '';
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

export function escapeMarkdownUrl(url:string): string {
    if (!url) return '';
    return url.replace(/[()\\]/g, '\\$&');
}