import axios from 'axios';
import * as cheerio from 'cheerio';
import {
  AppError,
  BlockedError,
  ParseError,
  ProdutoIndisponivelError,
  ScraperError,
} from '../errors/index.js';
import { validarResultadoScrape } from '../schemas/scrapeResult.schema.js';
import { parsePrice } from '../utils/parsePrice.js';
import { withRetry } from '../utils/retry.js';
import { randomBetween, sleep } from '../utils/sleep.js';
import { buildBrowserHeaders, getRandomUserAgent } from '../utils/userAgents.js';
import { extrairDeJsonLd } from './extractors/jsonLd.js';
import { extrairDeMetaTags } from './extractors/metaTags.js';

/** Códigos de erro de rede que costumam ser transitórios. */
const ERROS_REDE_TRANSITORIOS = new Set([
  'ECONNABORTED',
  'ETIMEDOUT',
  'ECONNRESET',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ERR_NETWORK',
  'ERR_SOCKET_CONNECTION_TIMEOUT',
]);

/**
 * Classe base de todos os scrapers (padrões Strategy + Template Method).
 *
 * O fluxo fixo (template) é: delay aleatório → busca do HTML com retry →
 * detecção de bloqueio → extração → validação com Zod.
 *
 * Cada loja (estratégia) só precisa declarar:
 *   - `static loja`:      identificador igual ao enum do banco;
 *   - `static dominios`:  domínios atendidos;
 *   - `static seletores`: seletores CSS de fallback;
 * e, opcionalmente, sobrescrever `detectarBloqueio()` ou `extrairComSeletores()`.
 */
export class BaseScraper {
  /** @type {string} */
  static loja = 'base';
  /** @type {string[]} */
  static dominios = [];
  /** @type {{ preco?: string[], precoOriginal?: string[], titulo?: string[], indisponivel?: string[] }} */
  static seletores = {};

  /**
   * @param {{
   *   httpClient?: { get: Function },
   *   logger?: import('pino').Logger,
   *   timeoutMs?: number,
   *   maxRetries?: number,
   *   minDelayMs?: number,
   *   maxDelayMs?: number,
   *   sleepFn?: (ms: number) => Promise<void>,
   *   random?: () => number,
   * }} [options]
   */
  constructor({
    httpClient = axios,
    logger,
    timeoutMs = 20000,
    maxRetries = 2,
    minDelayMs = 1500,
    maxDelayMs = 4000,
    sleepFn = sleep,
    random = Math.random,
  } = {}) {
    this.httpClient = httpClient;
    this.logger = logger;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.minDelayMs = minDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.sleepFn = sleepFn;
    this.random = random;
  }

  get loja() {
    return /** @type {typeof BaseScraper} */ (this.constructor).loja;
  }

  /**
   * Indica se esta estratégia atende à URL (compara o hostname com os domínios).
   * @param {string | URL} url
   */
  static supports(url) {
    let hostname;
    try {
      hostname = new URL(url).hostname.toLowerCase();
    } catch {
      return false;
    }
    return this.dominios.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  }

  /**
   * Template Method: fluxo completo de coleta de um produto.
   * @param {string} url
   */
  async scrape(url) {
    const contexto = { url, loja: this.loja };

    // Delay aleatório antes de cada produto: comportamento menos "robótico".
    await this.sleepFn(randomBetween(this.minDelayMs, this.maxDelayMs, this.random));

    const html = await withRetry(() => this.fetchHtml(url), {
      retries: this.maxRetries,
      baseDelayMs: 2000,
      maxDelayMs: 20000,
      sleepFn: this.sleepFn,
      random: this.random,
      onRetry: (err, tentativa, delayMs) =>
        this.logger?.warn(
          { ...contexto, tentativa, delayMs, erro: err.message },
          'Falha transitória; tentando novamente',
        ),
    });

    const dados = this.extrairDados(html, url);
    return validarResultadoScrape(dados, contexto);
  }

  /**
   * Busca o HTML via HTTP (Axios). Subclasses para páginas dinâmicas
   * (ex.: PlaywrightScraper) sobrescrevem este método.
   * @param {string} url
   * @returns {Promise<string>}
   */
  async fetchHtml(url) {
    const contexto = { url, loja: this.loja };
    let resposta;

    try {
      resposta = await this.httpClient.get(url, {
        headers: buildBrowserHeaders(getRandomUserAgent(this.random)),
        timeout: this.timeoutMs,
        responseType: 'text',
        maxRedirects: 5,
        // Tratamos os status manualmente para classificar o erro.
        validateStatus: () => true,
      });
    } catch (err) {
      throw this.converterErroDeRede(err, contexto);
    }

    const html = typeof resposta.data === 'string' ? resposta.data : String(resposta.data ?? '');
    this.verificarStatus(resposta.status, { ...contexto, status: resposta.status });

    if (this.detectarBloqueio(html)) {
      throw new BlockedError('A loja exibiu uma página de verificação (captcha/anti-bot)', {
        context: contexto,
        retryable: true,
      });
    }

    return html;
  }

  /** Classifica o status HTTP em erros tipados. */
  verificarStatus(status, contexto) {
    if (status >= 200 && status < 300) return;

    if (status === 403 || status === 429) {
      throw new BlockedError(`Acesso bloqueado pela loja (HTTP ${status})`, {
        context: contexto,
        retryable: true,
      });
    }
    if (status === 404 || status === 410) {
      throw new ScraperError(`Página do produto não encontrada (HTTP ${status})`, {
        context: contexto,
        retryable: false,
      });
    }
    throw new ScraperError(`Resposta HTTP inesperada (${status})`, {
      context: contexto,
      retryable: status >= 500 || status === 408,
    });
  }

  /** Converte erros do Axios/rede em ScraperError. */
  converterErroDeRede(err, contexto) {
    if (err instanceof AppError) return err;
    const codigo = err?.code;
    return new ScraperError(`Erro de rede ao acessar a loja: ${err?.message ?? err}`, {
      cause: err,
      context: { ...contexto, codigo },
      retryable: ERROS_REDE_TRANSITORIOS.has(codigo),
    });
  }

  /**
   * Hook: subclasses identificam páginas de captcha/anti-bot que retornam HTTP 200.
   * @param {string} _html
   */
  detectarBloqueio(_html) {
    return false;
  }

  /**
   * Extrai os dados em camadas: JSON-LD → meta tags → seletores CSS.
   * Cada camada preenche apenas o que as anteriores não encontraram.
   * @param {string} html
   * @param {string} url
   */
  extrairDados(html, url) {
    const $ = cheerio.load(html);
    const camadas = [extrairDeJsonLd($), extrairDeMetaTags($), this.extrairComSeletores($)].filter(
      Boolean,
    );

    const combinar = (campo) =>
      camadas.map((c) => c[campo]).find((v) => v !== null && v !== undefined) ?? null;

    const resultado = {
      titulo: combinar('titulo'),
      preco: combinar('preco'),
      precoOriginal: combinar('precoOriginal'),
      disponivel: combinar('disponivel'),
      moeda: combinar('moeda') ?? 'BRL',
    };

    if (resultado.preco === null) {
      if (resultado.disponivel === false) {
        throw new ProdutoIndisponivelError('Produto indisponível: a página não exibe preço', {
          context: { url, loja: this.loja },
        });
      }
      throw new ParseError(
        'Não foi possível encontrar o preço na página (o layout da loja pode ter mudado)',
        { context: { url, loja: this.loja } },
      );
    }

    return { ...resultado, disponivel: resultado.disponivel ?? true };
  }

  /**
   * Última camada: seletores CSS declarados em `static seletores`.
   * Pode ser sobrescrito quando a loja precisa de lógica especial.
   * @param {import('cheerio').CheerioAPI} $
   */
  extrairComSeletores($) {
    const { seletores } = /** @type {typeof BaseScraper} */ (this.constructor);
    const texto = (lista = []) => {
      for (const s of lista) {
        const valor = $(s).first().text().trim();
        if (valor) return valor;
      }
      return null;
    };

    const indisponivel = (seletores.indisponivel ?? []).some((s) => $(s).length > 0);

    return {
      titulo: texto(seletores.titulo),
      preco: parsePrice(texto(seletores.preco)),
      precoOriginal: parsePrice(texto(seletores.precoOriginal)),
      disponivel: indisponivel ? false : null,
      moeda: null,
    };
  }
}
