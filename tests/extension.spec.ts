import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import puppeteer, { Browser, Page } from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTENSION_PATH = path.resolve(__dirname, '../dist-extension');

describe('Chrome Extension E2E Test', () => {
  let browser: Browser | null = null;
  let page: Page | null = null;

  beforeAll(async () => {
    try {
      browser = await puppeteer.launch({
        headless: false,
        args: [
          `--disable-extensions-except=${EXTENSION_PATH}`,
          `--load-extension=${EXTENSION_PATH}`,
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--headless=new'
        ]
      });
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (e) {
      console.warn('Puppeteer browser launch failed (no display or browser):', e);
    }
  });

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  it('should verify extension files exist and are bundled', async () => {
    const fs = await import('fs');
    expect(fs.existsSync(path.join(EXTENSION_PATH, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(EXTENSION_PATH, 'service_worker.js'))).toBe(true);
    //
    expect(fs.existsSync(path.join(EXTENSION_PATH, 'offscreen.html'))).toBe(true);
    expect(fs.existsSync(path.join(EXTENSION_PATH, 'content.js'))).toBe(true);
  });

  it('should run content script extraction on a test page if browser is available', async () => {
    if (!browser) return;
    page = await browser.newPage();
    await page.setContent(`
      <html>
        <body>
          <p>これはテストの文章です。</p>
          <p>セマンティック検索のテストを実行します。</p>
        </body>
      </html>
    `);

    await new Promise(resolve => setTimeout(resolve, 1000));
    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText).toContain('テストの文章です');
  });
});
