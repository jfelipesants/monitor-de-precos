import { BlockedError, ConfigError } from '../errors/index.js';
import { buildBrowserHeaders, getRandomUserAgent } from '../utils/userAgents.js';
import { BaseScraper } from './BaseScraper.js';

/**
 * Base para lojas cujo preço é renderizado via JavaScript.
 *
 * Reaproveita todo o fluxo do BaseScraper (retry, extração, validação);
 * apenas troca a forma de obter o HTML: um navegador Chromium headless.
 *
 * O Playwright é carregado sob demanda (import dinâmico). Quem não monitora
 * lojas dinâmicas não paga o custo de instalar/abrir um navegador.
 */
export class PlaywrightScraper extends BaseScraper {
  /** Navegador compartilhado entre todas as instâncias (abrir um é caro). */
  static #browserPromise = null;

  /**
   * @param {ConstructorParameters<typeof BaseScraper>[0] & {
   *   launchBrowser?: () => Promise<import('playwright').Browser>
   * }} [options]
   */
  constructor(options = {}) {
    super(options);
    this.launchBrowser = options.launchBrowser ?? PlaywrightScraper.launchChromium;
  }

  static async launchChromium() {
    let playwright;
    try {
      playwright = await import('playwright');
    } catch (err) {
      throw new ConfigError(
        'Playwright não está instalado. Rode: npm install playwright && npx playwright install chromium',
        { cause: err },
      );
    }
    return playwright.chromium.launch({ headless: true });
  }

  async getBrowser() {
    if (!PlaywrightScraper.#browserPromise) {
      PlaywrightScraper.#browserPromise = this.launchBrowser().catch((err) => {
        PlaywrightScraper.#browserPromise = null; // permite tentar de novo depois
        throw err;
      });
    }
    return PlaywrightScraper.#browserPromise;
  }

  /** Fecha o navegador compartilhado (chamado no encerramento da aplicação). */
  static async closeBrowser() {
    const promise = PlaywrightScraper.#browserPromise;
    PlaywrightScraper.#browserPromise = null;
    if (!promise) return;
    try {
      const browser = await promise;
      await browser.close();
    } catch {
      // O navegador pode já ter sido fechado ou nunca ter aberto.
    }
  }

  /** @param {string} url */
  async fetchHtml(url) {
    const contexto = { url, loja: this.loja };
    const browser = await this.getBrowser();
    const userAgent = getRandomUserAgent(this.random);
    const { 'User-Agent': _ua, ...extraHeaders } = buildBrowserHeaders(userAgent);

    const context = await browser.newContext({
      userAgent,
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      viewport: { width: 1366, height: 768 },
      extraHTTPHeaders: extraHeaders,
    });

    try {
      const page = await context.newPage();
      let resposta;
      try {
        resposta = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });
      } catch (err) {
        const timeout = err?.name === 'TimeoutError';
        throw this.converterErroDeRede(
          Object.assign(err, { code: timeout ? 'ETIMEDOUT' : err?.code }),
          contexto,
        );
      }

      const status = resposta?.status() ?? 200;
      this.verificarStatus(status, { ...contexto, status });

      // Dá um tempo para o JavaScript da página renderizar o preço.
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      const html = await page.content();

      if (this.detectarBloqueio(html)) {
        throw new BlockedError('A loja exibiu uma página de verificação (captcha/anti-bot)', {
          context: contexto,
          retryable: true,
        });
      }
      return html;
    } finally {
      await context.close().catch(() => {});
    }
  }
}
