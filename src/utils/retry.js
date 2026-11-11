import { sleep } from './sleep.js';

/**
 * Backoff exponencial com "equal jitter":
 * metade do atraso é fixa e a outra metade é aleatória. Isso evita que várias
 * requisições falhas tentem de novo exatamente ao mesmo tempo.
 *
 * tentativa 0 → ~base, 1 → ~2×base, 2 → ~4×base... (limitado a maxDelayMs)
 */
export function computeBackoff(attempt, baseDelayMs, maxDelayMs, random = Math.random) {
  const exponencial = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.round(exponencial / 2 + (random() * exponencial) / 2);
}

/**
 * Executa `fn` e, se lançar um erro "retentável", tenta de novo com backoff.
 *
 * @template T
 * @param {(attempt: number) => Promise<T>} fn
 * @param {{
 *   retries?: number,
 *   baseDelayMs?: number,
 *   maxDelayMs?: number,
 *   shouldRetry?: (err: unknown) => boolean,
 *   onRetry?: (err: unknown, attempt: number, delayMs: number) => void,
 *   sleepFn?: (ms: number) => Promise<void>,
 *   random?: () => number,
 * }} [options]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, options = {}) {
  const {
    retries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 15000,
    shouldRetry = (err) => err?.retryable === true,
    onRetry,
    sleepFn = sleep,
    random = Math.random,
  } = options;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err)) throw err;

      const delay = computeBackoff(attempt, baseDelayMs, maxDelayMs, random);
      onRetry?.(err, attempt + 1, delay);
      await sleepFn(delay);
    }
  }
}
