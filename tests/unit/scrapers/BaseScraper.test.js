import { describe, expect, it, vi } from 'vitest';
import {
  BlockedError,
  ParseError,
  ProdutoIndisponivelError,
  ScraperError,
  ValidationError,
} from '../../../src/errors/index.js';
import { BaseScraper } from '../../../src/scrapers/BaseScraper.js';
import { criarHttpMock, criarLoggerFalso, opcoesScraperTeste } from '../../helpers/index.js';

class LojaTeste extends BaseScraper {
  static loja = 'teste';
  static dominios = ['loja-teste.com.br'];
  static seletores = { titulo: ['h1'], preco: ['.preco'], precoOriginal: ['.de'] };
}

const URL_PRODUTO = 'https://www.loja-teste.com.br/p/1';
const html = (corpo) => `<html><body>${corpo}</body></html>`;
const ok = (corpo) => ({ status: 200, data: html(corpo) });

function criarScraper(http, extras = {}) {
  return new LojaTeste({ httpClient: http, maxRetries: 2, ...opcoesScraperTeste, ...extras });
}

describe('BaseScraper.supports', () => {
  it.each([
    ['https://loja-teste.com.br/x', true],
    ['https://www.loja-teste.com.br/x', true],
    ['https://loja-teste.com.br.golpe.com/x', false],
    ['https://outra.com/x', false],
    ['não é url', false],
  ])('%s → %s', (url, esperado) => {
    expect(LojaTeste.supports(url)).toBe(esperado);
  });
});

describe('BaseScraper.scrape', () => {
  it('extrai e valida os dados usando seletores CSS', async () => {
    const http = criarHttpMock(
      ok('<h1>Produto X</h1><span class="de">R$ 200,00</span><span class="preco">R$ 149,90</span>'),
    );
    const r = await criarScraper(http).scrape(URL_PRODUTO);

    expect(r).toEqual({
      titulo: 'Produto X',
      preco: 149.9,
      precoOriginal: 200,
      disponivel: true,
      moeda: 'BRL',
    });
  });

  it('envia User-Agent de navegador, timeout e trata status manualmente', async () => {
    const http = criarHttpMock(ok('<span class="preco">10</span>'));
    await criarScraper(http, { timeoutMs: 1234 }).scrape(URL_PRODUTO);

    const [url, opcoes] = http.get.mock.calls[0];
    expect(url).toBe(URL_PRODUTO);
    expect(opcoes.headers['User-Agent']).toMatch(/Mozilla/);
    expect(opcoes.timeout).toBe(1234);
    expect(opcoes.validateStatus(500)).toBe(true);
  });

  it('aguarda um delay aleatório antes de acessar a loja', async () => {
    const sleepFn = vi.fn().mockResolvedValue();
    const http = criarHttpMock(ok('<span class="preco">10</span>'));
    await criarScraper(http, { sleepFn, minDelayMs: 1000, maxDelayMs: 1000 }).scrape(URL_PRODUTO);
    expect(sleepFn).toHaveBeenCalledWith(1000);
  });

  it('prioriza JSON-LD em relação aos seletores CSS', async () => {
    const jsonLd = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Product',
      name: 'Do JSON-LD',
      offers: { price: 99.9 },
    })}</script>`;
    const http = criarHttpMock(ok(`${jsonLd}<h1>Do H1</h1><span class="preco">R$ 1,00</span>`));
    const r = await criarScraper(http).scrape(URL_PRODUTO);
    expect(r).toMatchObject({ titulo: 'Do JSON-LD', preco: 99.9 });
  });

  it('tenta novamente em HTTP 503 e tem sucesso', async () => {
    const logger = criarLoggerFalso();
    const http = criarHttpMock({ status: 503, data: '' }, ok('<span class="preco">50</span>'));
    const r = await criarScraper(http, { logger }).scrape(URL_PRODUTO);

    expect(r.preco).toBe(50);
    expect(http.get).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ tentativa: 1 }),
      expect.any(String),
    );
  });

  it('tenta novamente em erro de rede transitório (timeout)', async () => {
    const timeout = Object.assign(new Error('timeout of 20000ms exceeded'), {
      code: 'ECONNABORTED',
    });
    const http = criarHttpMock(timeout, ok('<span class="preco">50</span>'));
    await expect(criarScraper(http).scrape(URL_PRODUTO)).resolves.toMatchObject({ preco: 50 });
  });

  it('lança BlockedError após esgotar as tentativas em HTTP 429', async () => {
    const http = criarHttpMock(
      { status: 429, data: '' },
      { status: 429, data: '' },
      { status: 429, data: '' },
    );
    const erro = await criarScraper(http)
      .scrape(URL_PRODUTO)
      .catch((e) => e);

    expect(erro).toBeInstanceOf(BlockedError);
    expect(erro.context).toMatchObject({ status: 429, loja: 'teste' });
    expect(http.get).toHaveBeenCalledTimes(3);
  });

  it('não tenta novamente em HTTP 404', async () => {
    const http = criarHttpMock({ status: 404, data: 'não encontrado' });
    const erro = await criarScraper(http)
      .scrape(URL_PRODUTO)
      .catch((e) => e);

    expect(erro).toBeInstanceOf(ScraperError);
    expect(erro.retryable).toBe(false);
    expect(erro.message).toMatch(/404/);
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('não tenta novamente em erro de DNS (ENOTFOUND)', async () => {
    const dns = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    const http = criarHttpMock(dns);
    const erro = await criarScraper(http)
      .scrape(URL_PRODUTO)
      .catch((e) => e);

    expect(erro).toBeInstanceOf(ScraperError);
    expect(erro.cause).toBe(dns);
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('lança ParseError quando não encontra o preço', async () => {
    const http = criarHttpMock(ok('<h1>Sem preço</h1>'));
    await expect(criarScraper(http).scrape(URL_PRODUTO)).rejects.toBeInstanceOf(ParseError);
  });

  it('lança ProdutoIndisponivelError quando a página indica falta de estoque', async () => {
    const http = criarHttpMock(
      ok('<meta property="product:availability" content="out of stock" />'),
    );
    await expect(criarScraper(http).scrape(URL_PRODUTO)).rejects.toBeInstanceOf(
      ProdutoIndisponivelError,
    );
  });

  it('lança ValidationError para preço implausível', async () => {
    const http = criarHttpMock(ok('<span class="preco">R$ 99.999.999,00</span>'));
    await expect(criarScraper(http).scrape(URL_PRODUTO)).rejects.toBeInstanceOf(ValidationError);
  });

  it('detecta página de bloqueio retornada com HTTP 200', async () => {
    class LojaComCaptcha extends LojaTeste {
      detectarBloqueio(h) {
        return h.includes('captcha');
      }
    }
    const http = criarHttpMock(
      { status: 200, data: 'captcha' },
      { status: 200, data: 'captcha' },
      { status: 200, data: 'captcha' },
    );
    const scraper = new LojaComCaptcha({ httpClient: http, maxRetries: 2, ...opcoesScraperTeste });
    await expect(scraper.scrape(URL_PRODUTO)).rejects.toBeInstanceOf(BlockedError);
  });
});
