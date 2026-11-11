import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockedError, ConfigError, ProdutoIndisponivelError } from '../../../src/errors/index.js';
import { PlaywrightScraper } from '../../../src/scrapers/PlaywrightScraper.js';
import { AmazonScraper } from '../../../src/scrapers/stores/AmazonScraper.js';
import { KabumScraper } from '../../../src/scrapers/stores/KabumScraper.js';
import { MercadoLivreScraper } from '../../../src/scrapers/stores/MercadoLivreScraper.js';
import { criarHttpMock, lerFixture, opcoesScraperTeste } from '../../helpers/index.js';

const resposta = (fixture) => ({ status: 200, data: lerFixture(fixture) });

describe('KabumScraper', () => {
  const url = 'https://www.kabum.com.br/produto/123456/placa-de-video';

  it('extrai os dados do JSON-LD', async () => {
    const scraper = new KabumScraper({
      httpClient: criarHttpMock(resposta('kabum-produto.html')),
      ...opcoesScraperTeste,
    });
    const r = await scraper.scrape(url);

    expect(r).toEqual({
      titulo: 'Placa de Vídeo RTX 4060 Ventus 2X Black OC, 8GB, GDDR6',
      preco: 1899.99,
      precoOriginal: 2399.99, // vem dos seletores: JSON-LD não informa preço "de"
      disponivel: true,
      moeda: 'BRL',
    });
  });

  it('usa os seletores CSS quando não há JSON-LD válido', async () => {
    const scraper = new KabumScraper({
      httpClient: criarHttpMock(resposta('kabum-sem-jsonld.html')),
      ...opcoesScraperTeste,
    });
    const r = await scraper.scrape(url);
    expect(r).toMatchObject({
      titulo: 'SSD Kingston NV2 1TB, M.2 2280 PCIe',
      preco: 429.9,
      precoOriginal: 599.9,
    });
  });

  it('atende apenas aos domínios da Kabum', () => {
    expect(KabumScraper.supports(url)).toBe(true);
    expect(KabumScraper.supports('https://www.amazon.com.br/dp/X')).toBe(false);
  });
});

describe('MercadoLivreScraper', () => {
  const url = 'https://produto.mercadolivre.com.br/MLB-123-fone';

  it('junta reais e centavos exibidos em elementos separados', async () => {
    const scraper = new MercadoLivreScraper({
      httpClient: criarHttpMock(resposta('mercadolivre-produto.html')),
      ...opcoesScraperTeste,
    });
    const r = await scraper.scrape(url);
    expect(r).toEqual({
      titulo: 'Fone De Ouvido Bluetooth JBL Tune 520BT Preto',
      preco: 1249.9,
      precoOriginal: 1599,
      disponivel: true,
      moeda: 'BRL',
    });
  });

  it('identifica produto indisponível', async () => {
    const scraper = new MercadoLivreScraper({
      httpClient: criarHttpMock(resposta('mercadolivre-indisponivel.html')),
      ...opcoesScraperTeste,
    });
    await expect(scraper.scrape(url)).rejects.toBeInstanceOf(ProdutoIndisponivelError);
  });

  it('detecta a página de verificação de conta (anti-bot)', () => {
    const scraper = new MercadoLivreScraper();
    expect(scraper.detectarBloqueio('<a href="/gz/account-verification?go=x">')).toBe(true);
    expect(scraper.detectarBloqueio(lerFixture('mercadolivre-produto.html'))).toBe(false);
  });

  it('atende a subdomínios do Mercado Livre', () => {
    expect(MercadoLivreScraper.supports(url)).toBe(true);
    expect(MercadoLivreScraper.supports('https://www.mercadolivre.com.br/p/MLB1')).toBe(true);
  });
});

describe('AmazonScraper (Playwright)', () => {
  const url = 'https://www.amazon.com.br/dp/B0CP31L73X';

  afterEach(async () => {
    await PlaywrightScraper.closeBrowser();
  });

  /** Navegador falso: simula a API do Playwright sem abrir o Chromium. */
  function criarBrowserFalso(html, status = 200) {
    const page = {
      goto: vi.fn().mockResolvedValue({ status: () => status }),
      waitForLoadState: vi.fn().mockResolvedValue(),
      content: vi.fn().mockResolvedValue(html),
    };
    const context = {
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(),
    };
    const browser = {
      newContext: vi.fn().mockResolvedValue(context),
      close: vi.fn().mockResolvedValue(),
    };
    return { browser, context, page };
  }

  it('extrai preço atual e original usando o navegador', async () => {
    const { browser, context } = criarBrowserFalso(lerFixture('amazon-produto.html'));
    const scraper = new AmazonScraper({
      launchBrowser: async () => browser,
      ...opcoesScraperTeste,
    });

    const r = await scraper.scrape(url);

    expect(r).toEqual({
      titulo: 'Kindle 16 GB (modelo 2024) - Preto',
      preco: 474.05,
      precoOriginal: 549,
      disponivel: true,
      moeda: 'BRL',
    });
    expect(browser.newContext).toHaveBeenCalledWith(expect.objectContaining({ locale: 'pt-BR' }));
    expect(context.close).toHaveBeenCalled(); // sempre libera o contexto
  });

  it('reaproveita o mesmo navegador entre coletas e o fecha no final', async () => {
    const { browser } = criarBrowserFalso(lerFixture('amazon-produto.html'));
    const launchBrowser = vi.fn().mockResolvedValue(browser);
    const scraper = new AmazonScraper({ launchBrowser, ...opcoesScraperTeste });

    await scraper.scrape(url);
    await scraper.scrape(url);
    expect(launchBrowser).toHaveBeenCalledTimes(1);

    await PlaywrightScraper.closeBrowser();
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('lança BlockedError na página de captcha', async () => {
    const { browser, context } = criarBrowserFalso(lerFixture('amazon-captcha.html'));
    const scraper = new AmazonScraper({
      launchBrowser: async () => browser,
      maxRetries: 0,
      ...opcoesScraperTeste,
    });

    await expect(scraper.scrape(url)).rejects.toBeInstanceOf(BlockedError);
    expect(context.close).toHaveBeenCalled();
  });

  it('classifica HTTP 503 como erro retentável', async () => {
    const { browser } = criarBrowserFalso('', 503);
    const scraper = new AmazonScraper({
      launchBrowser: async () => browser,
      maxRetries: 0,
      ...opcoesScraperTeste,
    });
    const erro = await scraper.scrape(url).catch((e) => e);
    expect(erro.retryable).toBe(true);
  });

  it('converte timeout de navegação em erro retentável', async () => {
    const { browser, page } = criarBrowserFalso('');
    page.goto.mockRejectedValue(
      Object.assign(new Error('Timeout 20000ms'), { name: 'TimeoutError' }),
    );
    const scraper = new AmazonScraper({
      launchBrowser: async () => browser,
      maxRetries: 0,
      ...opcoesScraperTeste,
    });

    const erro = await scraper.scrape(url).catch((e) => e);
    expect(erro.retryable).toBe(true);
    expect(erro.context.codigo).toBe('ETIMEDOUT');
  });

  it('propaga ConfigError se o Playwright não puder ser iniciado, e permite nova tentativa', async () => {
    const launchBrowser = vi
      .fn()
      .mockRejectedValueOnce(new ConfigError('Playwright não instalado'))
      .mockResolvedValue(criarBrowserFalso(lerFixture('amazon-produto.html')).browser);
    const scraper = new AmazonScraper({ launchBrowser, ...opcoesScraperTeste });

    await expect(scraper.scrape(url)).rejects.toBeInstanceOf(ConfigError);
    await expect(scraper.scrape(url)).resolves.toMatchObject({ preco: 474.05 });
  });
});
