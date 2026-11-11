/**
 * Modo daemon: mantém o processo vivo e executa o monitoramento
 * conforme CRON_SCHEDULE (fuso America/Sao_Paulo).
 *
 *   npm start          → aguarda o próximo horário agendado
 *   npm run start:now  → executa um ciclo imediatamente e depois segue o agendamento
 */
import cron from 'node-cron';
import { loadConfig, loadDotEnv } from './config/env.js';
import { criarContainer } from './container.js';
import { ConfigError } from './errors/index.js';
import { PlaywrightScraper } from './scrapers/PlaywrightScraper.js';

loadDotEnv();

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`\n❌ ${err.message}\n`);
  process.exit(1);
}

const { monitor, logger } = criarContainer(config);

if (!cron.validate(config.CRON_SCHEDULE)) {
  const err = new ConfigError(`CRON_SCHEDULE inválido: "${config.CRON_SCHEDULE}"`);
  logger.fatal(err.message);
  process.exit(1);
}

let emExecucao = false;

/** Executa um ciclo, impedindo que dois ciclos rodem ao mesmo tempo. */
async function executarCiclo() {
  if (emExecucao) {
    logger.warn('Ciclo anterior ainda em execução; pulando este disparo');
    return;
  }
  emExecucao = true;
  try {
    await monitor.executar();
  } catch (err) {
    logger.error({ err }, 'Erro no ciclo de monitoramento');
  } finally {
    emExecucao = false;
  }
}

const tarefa = cron.schedule(config.CRON_SCHEDULE, executarCiclo, {
  timezone: 'America/Sao_Paulo',
});

logger.info(
  { agendamento: config.CRON_SCHEDULE, fuso: 'America/Sao_Paulo' },
  'Monitor de Preços iniciado. Pressione Ctrl+C para sair.',
);

if (process.argv.includes('--now')) {
  executarCiclo();
}

/** Encerramento gracioso: para o cron e fecha o navegador. */
async function encerrar(sinal) {
  logger.info({ sinal }, 'Encerrando...');
  tarefa.stop();
  await PlaywrightScraper.closeBrowser();
  process.exit(0);
}

process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Promise rejeitada sem tratamento');
});
