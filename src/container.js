import { createLogger } from './config/logger.js';
import { AlertaRepository } from './database/AlertaRepository.js';
import { HistoricoRepository } from './database/HistoricoRepository.js';
import { ProdutoRepository } from './database/ProdutoRepository.js';
import { createSupabaseClient } from './database/supabaseClient.js';
import { EmailChannel } from './notifications/channels/EmailChannel.js';
import { NotificationService } from './notifications/NotificationService.js';
import { ScraperFactory } from './scrapers/ScraperFactory.js';
import { PriceMonitor } from './services/PriceMonitor.js';

/**
 * Composition root: o único lugar que conhece as implementações concretas
 * e "monta" a aplicação a partir da configuração.
 *
 * @param {ReturnType<typeof import('./config/env.js').loadConfig>} config
 */
export function criarContainer(config, { logger = createLogger(config) } = {}) {
  const supabase = createSupabaseClient(config);

  const produtoRepo = new ProdutoRepository(supabase);
  const historicoRepo = new HistoricoRepository(supabase);
  const alertaRepo = new AlertaRepository(supabase);

  const scraperFactory = new ScraperFactory({
    opcoesScraper: {
      logger,
      timeoutMs: config.SCRAPER_TIMEOUT_MS,
      maxRetries: config.SCRAPER_MAX_RETRIES,
      minDelayMs: config.SCRAPER_MIN_DELAY_MS,
      maxDelayMs: config.SCRAPER_MAX_DELAY_MS,
    },
  });

  const emailChannel = EmailChannel.fromConfig(config);
  const notificationService = new NotificationService({ canais: [emailChannel], logger });

  const monitor = new PriceMonitor({
    produtoRepo,
    historicoRepo,
    alertaRepo,
    scraperFactory,
    notificationService,
    logger,
    config: {
      concorrencia: config.SCRAPER_CONCURRENCY,
      limiarQueda: config.ALERT_DROP_THRESHOLD,
      minAmostras: config.ALERT_MIN_SAMPLES,
      cooldownHoras: config.ALERT_COOLDOWN_HOURS,
    },
  });

  return {
    config,
    logger,
    produtoRepo,
    historicoRepo,
    alertaRepo,
    scraperFactory,
    emailChannel,
    notificationService,
    monitor,
  };
}
