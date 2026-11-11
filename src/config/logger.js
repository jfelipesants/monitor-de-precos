import pino from 'pino';

/**
 * Logger estruturado.
 * - development: saída colorida e legível (pino-pretty);
 * - production:  JSON (ideal para agregadores de log e GitHub Actions).
 *
 * @param {{ LOG_LEVEL?: string, NODE_ENV?: string }} [config]
 */
export function createLogger({ LOG_LEVEL = 'info', NODE_ENV = 'development' } = {}) {
  const pretty = NODE_ENV === 'development';

  return pino({
    level: LOG_LEVEL,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(pretty && {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
      },
    }),
  });
}
