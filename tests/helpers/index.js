import { readFileSync } from 'node:fs';
import { vi } from 'vitest';

/** Lê um arquivo de tests/fixtures. */
export function lerFixture(nome) {
  return readFileSync(new URL(`../fixtures/${nome}`, import.meta.url), 'utf8');
}

/** Logger falso compatível com pino (inclusive `.child()`). */
export function criarLoggerFalso() {
  const logger = {
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  };
  logger.child = vi.fn(() => logger);
  return logger;
}

/**
 * Mock do cliente HTTP (substitui o Axios).
 * Ex.: criarHttpMock({ status: 200, data: '<html>' })
 */
export function criarHttpMock(...respostas) {
  const get = vi.fn();
  for (const r of respostas) {
    if (r instanceof Error) get.mockRejectedValueOnce(r);
    else get.mockResolvedValueOnce(r);
  }
  return { get };
}

/** Opções que deixam os scrapers instantâneos e determinísticos nos testes. */
export const opcoesScraperTeste = {
  sleepFn: () => Promise.resolve(),
  random: () => 0,
  minDelayMs: 0,
  maxDelayMs: 0,
};
