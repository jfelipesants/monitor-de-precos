/**
 * CLI para gerenciar produtos e testar a configuração.
 *
 *   npm run produto -- add --url <url> [--nome "<nome>"] [--alvo 1500]
 *   npm run produto -- list
 *   npm run produto -- disable --id <uuid>
 *   npm run produto -- test-scrape --url <url>    (só coleta, não salva nada)
 *   npm run produto -- test-email                 (envia um e-mail de teste)
 */
import { parseArgs } from 'node:util';
import { loadConfig, loadDotEnv } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { criarContainer } from '../container.js';
import { PlaywrightScraper } from '../scrapers/PlaywrightScraper.js';
import { ScraperFactory } from '../scrapers/ScraperFactory.js';
import { formatBRL } from '../utils/parsePrice.js';

const AJUDA = `
Uso: npm run produto -- <comando> [opções]

Comandos:
  add          Cadastra um produto
                 --url <url>        (obrigatório)
                 --nome "<nome>"    (opcional; se omitido, usa o título da página)
                 --alvo <preço>     (opcional; ex.: 1499.90)
  list         Lista todos os produtos
  disable      Desativa um produto      --id <uuid>
  test-scrape  Testa a coleta de uma URL sem salvar   --url <url>
  test-email   Envia um e-mail de teste para EMAIL_TO
`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string' },
    nome: { type: 'string' },
    alvo: { type: 'string' },
    id: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

const [comando] = positionals;

async function main() {
  if (!comando || values.help) {
    console.log(AJUDA);
    return;
  }

  loadDotEnv();

  // test-scrape não precisa de banco nem de e-mail configurados.
  if (comando === 'test-scrape') {
    exigir(values.url, '--url');
    const logger = createLogger({ LOG_LEVEL: 'warn' });
    const scraper = new ScraperFactory({
      opcoesScraper: { logger, minDelayMs: 0, maxDelayMs: 0 },
    }).obterScraper(values.url);
    const r = await scraper.scrape(values.url);
    console.log(`\n✅ Coleta OK (${scraper.loja})`);
    console.table({
      Título: r.titulo,
      Preço: formatBRL(r.preco),
      'Preço original': r.precoOriginal ? formatBRL(r.precoOriginal) : '-',
      Disponível: r.disponivel ? 'sim' : 'não',
    });
    return;
  }

  const config = loadConfig();
  const app = criarContainer(config, { logger: createLogger({ ...config, LOG_LEVEL: 'warn' }) });

  switch (comando) {
    case 'add': {
      exigir(values.url, '--url');
      const loja = app.scraperFactory.detectarLoja(values.url);
      let nome = values.nome;
      if (!nome) {
        console.log('Buscando o nome do produto na página...');
        const r = await app.scraperFactory.obterScraper(values.url).scrape(values.url);
        nome = (r.titulo ?? 'Produto sem nome').slice(0, 200);
        console.log(`Preço atual: ${formatBRL(r.preco)}`);
      }
      const produto = await app.produtoRepo.criar({
        nome,
        url: values.url,
        loja,
        preco_alvo: values.alvo ? Number(values.alvo.replace(',', '.')) : null,
      });
      console.log(`\n✅ Produto cadastrado: ${produto.nome} (${produto.id})`);
      break;
    }

    case 'list': {
      const produtos = await app.produtoRepo.listarTodos();
      if (produtos.length === 0) {
        console.log('Nenhum produto cadastrado.');
        break;
      }
      console.table(
        produtos.map((p) => ({
          id: p.id,
          nome: p.nome.length > 40 ? `${p.nome.slice(0, 37)}...` : p.nome,
          loja: p.loja,
          ativo: p.ativo ? 'sim' : 'não',
          meta: p.preco_alvo ? formatBRL(p.preco_alvo) : '-',
          'último preço': p.ultimo_preco ? formatBRL(p.ultimo_preco) : '-',
          'último erro': p.ultimo_erro ? p.ultimo_erro.slice(0, 40) : '',
        })),
      );
      break;
    }

    case 'disable': {
      exigir(values.id, '--id');
      await app.produtoRepo.desativar(values.id);
      console.log('✅ Produto desativado.');
      break;
    }

    case 'test-email': {
      await app.emailChannel.verificar();
      // Exemplo com 12 coletas (a cada 6h) descendo até cruzar a meta.
      const precos = [
        1799.9, 1799.9, 1749, 1769.9, 1719, 1689.9, 1659, 1679.9, 1599, 1579.9, 1549, 1399.9,
      ];
      const agora = Date.now();
      const historico = precos.map((preco, i) => ({
        preco,
        coletado_em: new Date(agora - (precos.length - 1 - i) * 6 * 3_600_000).toISOString(),
      }));
      await app.emailChannel.enviar({
        produto: {
          nome: 'Produto de teste do Monitor de Preços',
          url: 'https://github.com',
          loja: 'kabum',
          preco_alvo: 1500,
        },
        precoAtual: 1399.9,
        precoOriginal: 1799.9,
        motivos: [
          { tipo: 'meta_atingida', precoReferencia: 1500, variacaoPercentual: -6.67 },
          { tipo: 'menor_preco_historico', precoReferencia: 1549, variacaoPercentual: -9.63 },
        ],
        estatisticas: { media: 1665.6, minimoHistorico: 1549 },
        historico,
        coletadoEm: new Date(agora).toISOString(),
      });
      console.log(`✅ E-mail de teste enviado para ${config.EMAIL_TO}`);
      break;
    }

    default:
      console.error(`Comando desconhecido: "${comando}"`);
      console.log(AJUDA);
      process.exitCode = 1;
  }
}

function exigir(valor, flag) {
  if (!valor) {
    console.error(`❌ Informe ${flag}`);
    console.log(AJUDA);
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error(`\n❌ ${err.name}: ${err.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => PlaywrightScraper.closeBrowser());
