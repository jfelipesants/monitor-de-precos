import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockedError, DatabaseError, ProdutoIndisponivelError } from '../../src/errors/index.js';
import { PriceMonitor } from '../../src/services/PriceMonitor.js';
import { criarLoggerFalso } from '../helpers/index.js';

/**
 * Testa o fluxo completo do ciclo de monitoramento com todas as
 * dependências externas (banco, lojas, e-mail) substituídas por mocks.
 */

const AGORA = new Date('2026-06-10T12:00:00Z');

const produto = (id, extra = {}) => ({
  id,
  nome: `Produto ${id}`,
  url: `https://www.kabum.com.br/produto/${id}`,
  loja: 'kabum',
  preco_alvo: null,
  ativo: true,
  ...extra,
});

const resultadoScrape = (preco, extra = {}) => ({
  titulo: 'X',
  preco,
  precoOriginal: null,
  disponivel: true,
  moeda: 'BRL',
  ...extra,
});

function montarCenario({ produtos, precos, estatisticas, ultimoAlerta = null }) {
  const ordem = [];

  const produtoRepo = {
    listarAtivos: vi.fn().mockResolvedValue(produtos),
    atualizarStatusColeta: vi.fn().mockResolvedValue(),
  };
  const historicoRepo = {
    obterEstatisticas: vi.fn(async () => {
      ordem.push('estatisticas');
      return estatisticas ?? { amostras: 10, media: 1000, minimo: 950, minimoHistorico: 900 };
    }),
    registrar: vi.fn(async () => {
      ordem.push('registrar');
    }),
  };
  const alertaRepo = {
    ultimoAlerta: vi.fn().mockResolvedValue(ultimoAlerta),
    registrar: vi.fn().mockResolvedValue(),
  };
  const scraper = {
    scrape: vi.fn(async (url) => {
      const id = url.split('/').pop();
      const r = precos[id];
      if (r instanceof Error) throw r;
      return typeof r === 'number' ? resultadoScrape(r) : r;
    }),
  };
  const scraperFactory = { obterScraper: vi.fn(() => scraper) };
  const notificationService = {
    notificar: vi.fn().mockResolvedValue({ enviados: ['email'], falhas: [] }),
  };
  const logger = criarLoggerFalso();

  const monitor = new PriceMonitor({
    produtoRepo,
    historicoRepo,
    alertaRepo,
    scraperFactory,
    notificationService,
    logger,
    config: { concorrencia: 2, limiarQueda: 0.1, minAmostras: 5, cooldownHoras: 24 },
    relogio: () => AGORA,
  });

  return {
    monitor,
    produtoRepo,
    historicoRepo,
    alertaRepo,
    scraper,
    notificationService,
    logger,
    ordem,
  };
}

describe('PriceMonitor (integração)', () => {
  let cenario;

  describe('ciclo sem alertas', () => {
    beforeEach(() => {
      cenario = montarCenario({ produtos: [produto('a')], precos: { a: 990 } });
    });

    it('coleta, salva no histórico e atualiza o produto', async () => {
      const resumo = await cenario.monitor.executar();

      expect(resumo).toMatchObject({ total: 1, sucesso: 1, falhas: [], alertasEnviados: 0 });
      expect(cenario.historicoRepo.registrar).toHaveBeenCalledWith({
        produto_id: 'a',
        preco: 990,
        preco_original: null,
        disponivel: true,
      });
      expect(cenario.produtoRepo.atualizarStatusColeta).toHaveBeenCalledWith('a', {
        ultimo_preco: 990,
        ultima_coleta: AGORA.toISOString(),
        ultimo_erro: null,
      });
      expect(cenario.notificationService.notificar).not.toHaveBeenCalled();
    });

    it('lê as estatísticas ANTES de inserir o novo preço', async () => {
      await cenario.monitor.executar();
      expect(cenario.ordem).toEqual(['estatisticas', 'registrar']);
    });
  });

  it('envia alerta quando a meta é atingida e registra o alerta', async () => {
    cenario = montarCenario({ produtos: [produto('a', { preco_alvo: 1000 })], precos: { a: 980 } });

    const resumo = await cenario.monitor.executar();

    expect(resumo.alertasEnviados).toBe(1);
    const alerta = cenario.notificationService.notificar.mock.calls[0][0];
    expect(alerta).toMatchObject({ precoAtual: 980, produto: { id: 'a' } });
    expect(alerta.motivos.map((m) => m.tipo)).toEqual(['meta_atingida']);
    expect(cenario.alertaRepo.registrar).toHaveBeenCalledWith({
      produto_id: 'a',
      tipo: 'meta_atingida',
      preco: 980,
      preco_referencia: 1000,
      canais: ['email'],
    });
  });

  it('agrupa vários motivos em um único e-mail', async () => {
    cenario = montarCenario({ produtos: [produto('a', { preco_alvo: 1000 })], precos: { a: 800 } });
    await cenario.monitor.executar();

    expect(cenario.notificationService.notificar).toHaveBeenCalledOnce();
    expect(cenario.alertaRepo.registrar).toHaveBeenCalledTimes(3);
  });

  it('não repete o alerta durante o cooldown', async () => {
    cenario = montarCenario({
      produtos: [produto('a', { preco_alvo: 1000 })],
      precos: { a: 980 },
      ultimoAlerta: { preco: 980, enviado_em: new Date(AGORA.getTime() - 3_600_000).toISOString() },
    });

    const resumo = await cenario.monitor.executar();

    expect(resumo.alertasEnviados).toBe(0);
    expect(cenario.notificationService.notificar).not.toHaveBeenCalled();
  });

  it('isola falhas: um produto com erro não impede os demais', async () => {
    cenario = montarCenario({
      produtos: [produto('a'), produto('b'), produto('c')],
      precos: {
        a: 990,
        b: new BlockedError('HTTP 403', { retryable: true }),
        c: 995,
      },
    });

    const resumo = await cenario.monitor.executar();

    expect(resumo).toMatchObject({ total: 3, sucesso: 2 });
    expect(resumo.falhas).toEqual([
      { produto: 'Produto b', erro: 'HTTP 403', tipo: 'BlockedError' },
    ]);
    expect(cenario.produtoRepo.atualizarStatusColeta).toHaveBeenCalledWith('b', {
      ultimo_erro: 'HTTP 403',
    });
    expect(cenario.historicoRepo.registrar).toHaveBeenCalledTimes(2);
    expect(cenario.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ total: 3 }),
      expect.any(String),
    );
  });

  it('registra produto indisponível como aviso, não como erro', async () => {
    cenario = montarCenario({
      produtos: [produto('a')],
      precos: { a: new ProdutoIndisponivelError('Esgotado') },
    });
    await cenario.monitor.executar();
    expect(cenario.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ nome: 'Produto a' }),
      'Falha ao processar produto',
    );
    expect(cenario.logger.error).not.toHaveBeenCalled();
  });

  it('falha no envio do e-mail NÃO perde o preço coletado', async () => {
    cenario = montarCenario({ produtos: [produto('a', { preco_alvo: 1000 })], precos: { a: 980 } });
    cenario.notificationService.notificar.mockResolvedValue({
      enviados: [],
      falhas: [{ canal: 'email', erro: 'x' }],
    });

    const resumo = await cenario.monitor.executar();

    expect(resumo).toMatchObject({ sucesso: 1, alertasEnviados: 0 });
    expect(cenario.historicoRepo.registrar).toHaveBeenCalled();
    expect(cenario.alertaRepo.registrar).not.toHaveBeenCalled();
  });

  it('erro inesperado na etapa de alerta não derruba a coleta', async () => {
    cenario = montarCenario({ produtos: [produto('a', { preco_alvo: 1000 })], precos: { a: 980 } });
    cenario.alertaRepo.ultimoAlerta.mockRejectedValue(new DatabaseError('timeout'));

    const resumo = await cenario.monitor.executar();
    expect(resumo).toMatchObject({ sucesso: 1, alertasEnviados: 0 });
  });

  it('alerta enviado mas não registrado continua contando como enviado', async () => {
    cenario = montarCenario({ produtos: [produto('a', { preco_alvo: 1000 })], precos: { a: 980 } });
    cenario.alertaRepo.registrar.mockRejectedValue(new DatabaseError('falhou'));

    const resumo = await cenario.monitor.executar();
    expect(resumo.alertasEnviados).toBe(1);
    expect(cenario.logger.warn).toHaveBeenCalledWith(
      expect.anything(),
      'Alerta enviado, mas não foi registrado no banco',
    );
  });

  it('se não conseguir gravar o erro do produto, ainda assim reporta a falha original', async () => {
    cenario = montarCenario({
      produtos: [produto('a')],
      precos: { a: new Error('falha de scraping') },
    });
    cenario.produtoRepo.atualizarStatusColeta.mockRejectedValue(new DatabaseError('banco fora'));

    const resumo = await cenario.monitor.executar();
    expect(resumo.falhas[0].erro).toBe('falha de scraping');
  });

  it('retorna resumo vazio quando não há produtos ativos', async () => {
    cenario = montarCenario({ produtos: [], precos: {} });
    const resumo = await cenario.monitor.executar();
    expect(resumo).toMatchObject({ total: 0, sucesso: 0 });
    expect(cenario.scraper.scrape).not.toHaveBeenCalled();
  });

  it('propaga erro fatal ao listar produtos (ex.: banco fora do ar)', async () => {
    cenario = montarCenario({ produtos: [], precos: {} });
    cenario.produtoRepo.listarAtivos.mockRejectedValue(new DatabaseError('sem conexão'));
    await expect(cenario.monitor.executar()).rejects.toThrow('sem conexão');
  });
});
