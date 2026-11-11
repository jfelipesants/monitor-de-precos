/**
 * Executa UM ciclo de monitoramento e encerra.
 * Ideal para agendadores externos (GitHub Actions, cron do sistema).
 *
 * Códigos de saída:
 *   0 → ciclo concluído (mesmo com falhas pontuais em alguns produtos)
 *   1 → erro fatal (config inválida, banco fora do ar) ou TODOS os produtos falharam
 */
import { loadConfig, loadDotEnv } from './config/env.js';
import { criarContainer } from './container.js';
import { PlaywrightScraper } from './scrapers/PlaywrightScraper.js';

async function main() {
  loadDotEnv();
  const config = loadConfig();
  const { monitor, logger } = criarContainer(config);

  try {
    const resumo = await monitor.executar();
    const todosFalharam = resumo.total > 0 && resumo.sucesso === 0;
    if (todosFalharam) logger.error('Todos os produtos falharam neste ciclo');
    return todosFalharam ? 1 : 0;
  } finally {
    await PlaywrightScraper.closeBrowser();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`\n❌ Erro fatal: ${err.message}\n`);
    if (err.cause) console.error('Causa:', err.cause);
    process.exitCode = 1;
  });
