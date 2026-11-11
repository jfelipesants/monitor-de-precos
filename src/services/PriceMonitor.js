import { mensagemDeErro, ProdutoIndisponivelError } from '../errors/index.js';
import { mapWithConcurrency } from '../utils/concurrency.js';
import { analisarPreco, estaEmCooldown } from './PriceAnalyzer.js';

/**
 * Orquestrador de um ciclo de monitoramento.
 *
 * Recebe todas as dependências pelo construtor (injeção de dependência),
 * então os testes conseguem substituir banco, scrapers e e-mail por mocks.
 */
export class PriceMonitor {
  /**
   * @param {{
   *   produtoRepo: import('../database/ProdutoRepository.js').ProdutoRepository,
   *   historicoRepo: import('../database/HistoricoRepository.js').HistoricoRepository,
   *   alertaRepo: import('../database/AlertaRepository.js').AlertaRepository,
   *   scraperFactory: import('../scrapers/ScraperFactory.js').ScraperFactory,
   *   notificationService: import('../notifications/NotificationService.js').NotificationService,
   *   logger: import('pino').Logger,
   *   config: { concorrencia: number, limiarQueda: number, minAmostras: number, cooldownHoras: number },
   *   relogio?: () => Date,
   * }} deps
   */
  constructor({
    produtoRepo,
    historicoRepo,
    alertaRepo,
    scraperFactory,
    notificationService,
    logger,
    config,
    relogio = () => new Date(),
  }) {
    this.produtoRepo = produtoRepo;
    this.historicoRepo = historicoRepo;
    this.alertaRepo = alertaRepo;
    this.scraperFactory = scraperFactory;
    this.notificationService = notificationService;
    this.logger = logger;
    this.config = config;
    this.relogio = relogio;
  }

  /**
   * Executa um ciclo completo para todos os produtos ativos.
   * Erros de produtos individuais são isolados e aparecem no resumo.
   */
  async executar() {
    const inicio = Date.now();
    const produtos = await this.produtoRepo.listarAtivos();

    if (produtos.length === 0) {
      this.logger.warn('Nenhum produto ativo para monitorar. Cadastre com: npm run produto -- add');
      return {
        total: 0,
        sucesso: 0,
        falhas: [],
        alertasEnviados: 0,
        duracaoMs: Date.now() - inicio,
      };
    }

    this.logger.info({ total: produtos.length }, 'Iniciando ciclo de monitoramento');

    const resultados = await mapWithConcurrency(produtos, this.config.concorrencia, (produto) =>
      this.processarProduto(produto),
    );

    const resumo = {
      total: produtos.length,
      sucesso: 0,
      falhas: [],
      alertasEnviados: 0,
      duracaoMs: 0,
    };

    resultados.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        resumo.sucesso++;
        if (r.value.alertaEnviado) resumo.alertasEnviados++;
      } else {
        resumo.falhas.push({
          produto: produtos[i].nome,
          erro: mensagemDeErro(r.reason),
          tipo: r.reason?.name ?? 'Error',
        });
      }
    });
    resumo.duracaoMs = Date.now() - inicio;

    const nivel = resumo.falhas.length > 0 ? 'warn' : 'info';
    this.logger[nivel](resumo, 'Ciclo de monitoramento concluído');
    return resumo;
  }

  /**
   * Coleta, persiste e avalia um único produto.
   * @param {{ id: string, nome: string, url: string, loja: string, preco_alvo: number|null }} produto
   */
  async processarProduto(produto) {
    const log = this.logger.child({ produtoId: produto.id, loja: produto.loja });

    try {
      const scraper = this.scraperFactory.obterScraper(produto.url);
      const resultado = await scraper.scrape(produto.url);

      // Estatísticas ANTES de inserir o novo preço: a comparação é com o passado.
      const estatisticas = await this.historicoRepo.obterEstatisticas(produto.id);

      await this.historicoRepo.registrar({
        produto_id: produto.id,
        preco: resultado.preco,
        preco_original: resultado.precoOriginal,
        disponivel: resultado.disponivel,
      });

      await this.produtoRepo.atualizarStatusColeta(produto.id, {
        ultimo_preco: resultado.preco,
        ultima_coleta: this.relogio().toISOString(),
        ultimo_erro: null,
      });

      log.info({ preco: resultado.preco, nome: produto.nome }, 'Preço coletado');

      const alertaEnviado = await this.avaliarEAlertar(produto, resultado, estatisticas, log);
      return { produtoId: produto.id, preco: resultado.preco, alertaEnviado };
    } catch (err) {
      const nivel = err instanceof ProdutoIndisponivelError ? 'warn' : 'error';
      log[nivel]({ err, nome: produto.nome }, 'Falha ao processar produto');

      await this.produtoRepo
        .atualizarStatusColeta(produto.id, { ultimo_erro: mensagemDeErro(err).slice(0, 500) })
        .catch((e) => log.warn({ err: e }, 'Não foi possível registrar o erro no produto'));

      throw err;
    }
  }

  /**
   * Avalia as regras e envia o alerta. Nunca lança: o preço já foi salvo,
   * então uma falha aqui não deve marcar a coleta como mal-sucedida.
   * @returns {Promise<boolean>} true se ao menos um canal recebeu o alerta
   */
  async avaliarEAlertar(produto, resultado, estatisticas, log) {
    try {
      const motivos = analisarPreco({
        precoAtual: resultado.preco,
        precoAlvo: produto.preco_alvo,
        estatisticas,
        limiarQueda: this.config.limiarQueda,
        minAmostras: this.config.minAmostras,
      });
      if (motivos.length === 0) return false;

      const motivosAtivos = [];
      for (const motivo of motivos) {
        const ultimoAlerta = await this.alertaRepo.ultimoAlerta(produto.id, motivo.tipo);
        const emCooldown = estaEmCooldown({
          ultimoAlerta,
          precoAtual: resultado.preco,
          cooldownHoras: this.config.cooldownHoras,
          agora: this.relogio(),
        });
        if (emCooldown) {
          log.debug({ tipo: motivo.tipo }, 'Alerta suprimido (cooldown)');
        } else {
          motivosAtivos.push(motivo);
        }
      }
      if (motivosAtivos.length === 0) return false;

      const { enviados } = await this.notificationService.notificar({
        produto,
        precoAtual: resultado.preco,
        precoOriginal: resultado.precoOriginal,
        motivos: motivosAtivos,
        estatisticas,
      });

      if (enviados.length === 0) {
        log.error('Alerta não foi entregue por nenhum canal');
        return false;
      }

      for (const motivo of motivosAtivos) {
        await this.alertaRepo
          .registrar({
            produto_id: produto.id,
            tipo: motivo.tipo,
            preco: resultado.preco,
            preco_referencia: motivo.precoReferencia,
            canais: enviados,
          })
          .catch((err) => log.warn({ err }, 'Alerta enviado, mas não foi registrado no banco'));
      }

      log.info({ motivos: motivosAtivos.map((m) => m.tipo), canais: enviados }, 'Alerta enviado');
      return true;
    } catch (err) {
      log.error({ err }, 'Erro ao avaliar/enviar alerta (o preço foi salvo normalmente)');
      return false;
    }
  }
}
