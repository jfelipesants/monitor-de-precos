import { describe, expect, it, vi } from 'vitest';
import { ScraperError } from '../../../src/errors/index.js';
import { computeBackoff, withRetry } from '../../../src/utils/retry.js';

const semEspera = () => Promise.resolve();

describe('computeBackoff', () => {
  it('cresce exponencialmente (com random fixo)', () => {
    const r = () => 1; // jitter máximo
    expect(computeBackoff(0, 1000, 60000, r)).toBe(1000);
    expect(computeBackoff(1, 1000, 60000, r)).toBe(2000);
    expect(computeBackoff(2, 1000, 60000, r)).toBe(4000);
  });

  it('respeita o limite máximo', () => {
    expect(computeBackoff(10, 1000, 5000, () => 1)).toBe(5000);
  });

  it('nunca fica abaixo da metade do atraso exponencial (equal jitter)', () => {
    expect(computeBackoff(1, 1000, 60000, () => 0)).toBe(1000);
  });
});

describe('withRetry', () => {
  it('retorna o resultado sem tentar de novo quando dá certo', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn, { sleepFn: semEspera })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('tenta novamente em erros retentáveis e depois tem sucesso', async () => {
    const erro = new ScraperError('timeout', { retryable: true });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(erro)
      .mockRejectedValueOnce(erro)
      .mockResolvedValue('ok');
    const onRetry = vi.fn();
    const sleepFn = vi.fn(semEspera);

    await expect(withRetry(fn, { retries: 3, sleepFn, onRetry })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][1]).toBe(1); // número da tentativa
    expect(sleepFn).toHaveBeenCalledTimes(2);
  });

  it('não tenta de novo em erro não retentável', async () => {
    const fn = vi.fn().mockRejectedValue(new ScraperError('404', { retryable: false }));
    await expect(withRetry(fn, { retries: 5, sleepFn: semEspera })).rejects.toThrow('404');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('desiste após esgotar as tentativas e lança o último erro', async () => {
    const fn = vi.fn().mockRejectedValue(new ScraperError('503', { retryable: true }));
    await expect(withRetry(fn, { retries: 2, sleepFn: semEspera })).rejects.toThrow('503');
    expect(fn).toHaveBeenCalledTimes(3); // 1 tentativa + 2 retries
  });

  it('aceita um critério de retry personalizado', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('qualquer')).mockResolvedValue(42);
    await expect(withRetry(fn, { shouldRetry: () => true, sleepFn: semEspera })).resolves.toBe(42);
  });
});
