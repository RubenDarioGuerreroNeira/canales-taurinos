import { Injectable, Logger } from '@nestjs/common';
import puppeteer, { Browser, Page } from 'puppeteer';
import chromium from 'chromium';

@Injectable()
export class PuppeteerService {
  private readonly logger = new Logger(PuppeteerService.name);

  async launchBrowser(): Promise<Browser> {
    const isRender = !!process.env.RENDER;
    this.logger.log(`Lanzando Puppeteer (Render: ${isRender})...`);

    return puppeteer.launch({
      executablePath: isRender ? chromium.path : undefined,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });
  }

  async setupPage(browser: Browser): Promise<Page> {
    const page = await browser.newPage();

    // Anti-detection techniques
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['es-ES', 'es', 'en-US', 'en'] });
      (window as any).chrome = { runtime: {} };
    });

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    );

    await page.setViewport({ width: 1920, height: 1080 });

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      'Cache-Control': 'max-age=0',
    });

    return page;
  }

  async blockUnnecessaryResources(page: Page): Promise<void> {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      ['image', 'stylesheet', 'font'].includes(req.resourceType())
        ? req.abort()
        : req.continue();
    });
  }
}
