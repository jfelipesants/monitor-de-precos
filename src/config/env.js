import { z } from 'zod';
import { ConfigError } from '../errors/index.js';

/** "true"/"false" (string do .env) → boolean. */
const booleanString = (padrao) =>
  z
    .enum(['true', 'false'])
    .default(padrao)
    .transform((v) => v === 'true');

/** Trata string vazia do .env ("EMAIL_FROM=") como ausente. */
const opcional = (schema) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    schema.optional(),
  );

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    SUPABASE_URL: z.url({ message: 'SUPABASE_URL deve ser uma URL válida' }),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'SUPABASE_SERVICE_ROLE_KEY parece inválida'),

    SMTP_HOST: z.string().min(1).default('smtp.gmail.com'),
    SMTP_PORT: z.coerce.number().int().positive().default(465),
    SMTP_SECURE: booleanString('true'),
    SMTP_USER: z.email({ message: 'SMTP_USER deve ser um e-mail válido' }),
    SMTP_PASS: z.string().min(1, 'SMTP_PASS é obrigatório (use uma senha de app do Gmail)'),
    EMAIL_FROM: opcional(z.string()),
    EMAIL_TO: z.email({ message: 'EMAIL_TO deve ser um e-mail válido' }),

    CRON_SCHEDULE: z.string().min(1).default('0 */6 * * *'),

    ALERT_DROP_THRESHOLD: z.coerce.number().min(0).max(1).default(0.1),
    ALERT_MIN_SAMPLES: z.coerce.number().int().min(1).default(5),
    ALERT_COOLDOWN_HOURS: z.coerce.number().min(0).default(24),

    SCRAPER_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
    SCRAPER_MIN_DELAY_MS: z.coerce.number().int().min(0).default(1500),
    SCRAPER_MAX_DELAY_MS: z.coerce.number().int().min(0).default(4000),
    SCRAPER_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
    SCRAPER_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
  })
  .refine((env) => env.SCRAPER_MAX_DELAY_MS >= env.SCRAPER_MIN_DELAY_MS, {
    message: 'SCRAPER_MAX_DELAY_MS deve ser maior ou igual a SCRAPER_MIN_DELAY_MS',
    path: ['SCRAPER_MAX_DELAY_MS'],
  });

const isVazio = (v) => v === undefined || (typeof v === 'string' && v.trim() === '');

/**
 * Valida as variáveis de ambiente e devolve a configuração tipada.
 * Falha cedo ("fail fast") com uma mensagem que lista TODOS os problemas.
 *
 * @param {Record<string, string | undefined>} [source]
 */
export function loadConfig(source = process.env) {
  const resultado = envSchema.safeParse(source);

  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map((issue) => {
        const campo = issue.path.join('.') || '(raiz)';
        const ausente = issue.path.length === 1 && isVazio(source[issue.path[0]]);
        return `  • ${campo}: ${ausente ? 'variável obrigatória não definida' : issue.message}`;
      })
      .join('\n');
    throw new ConfigError(`Configuração inválida. Verifique seu arquivo .env:\n${problemas}`, {
      context: { campos: resultado.error.issues.map((i) => i.path.join('.')) },
    });
  }

  return Object.freeze(resultado.data);
}

/**
 * Carrega o arquivo .env (se existir) usando o suporte nativo do Node (>= 20.12).
 * Variáveis já definidas no ambiente (ex.: secrets do GitHub Actions) têm prioridade.
 */
export function loadDotEnv(path = '.env') {
  try {
    process.loadEnvFile(path);
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
}
