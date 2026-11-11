import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../../../src/utils/concurrency.js';
import { randomBetween, sleep } from '../../../src/utils/sleep.js';
import {
  buildBrowserHeaders,
  getRandomUserAgent,
  USER_AGENTS,
} from '../../../src/utils/userAgents.js';

describe('mapWithConcurrency', () => {
  it('preserva a ordem e isola falhas', async () => {
    const resultado = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => {
      if (n === 3) throw new Error('falhou 3');
      return n * 10;
    });

    expect(resultado.map((r) => r.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'rejected',
      'fulfilled',
    ]);
    expect(resultado[1].value).toBe(20);
    expect(resultado[2].reason.message).toBe('falhou 3');
  });

  it('nunca ultrapassa o limite de execuções simultâneas', async () => {
    let ativos = 0;
    let pico = 0;
    await mapWithConcurrency(Array.from({ length: 10 }), 3, async () => {
      ativos++;
      pico = Math.max(pico, ativos);
      await sleep(5);
      ativos--;
    });
    expect(pico).toBe(3);
  });

  it('lida com lista vazia', async () => {
    await expect(mapWithConcurrency([], 5, async () => 1)).resolves.toEqual([]);
  });
});

describe('randomBetween', () => {
  it('respeita os limites', () => {
    expect(randomBetween(10, 20, () => 0)).toBe(10);
    expect(randomBetween(10, 20, () => 0.9999)).toBe(20);
    expect(randomBetween(20, 10, () => 0)).toBe(10); // limites invertidos
  });
});

describe('userAgents', () => {
  it('sorteia um User-Agent do pool', () => {
    expect(USER_AGENTS).toContain(getRandomUserAgent());
    expect(getRandomUserAgent(() => 0)).toBe(USER_AGENTS[0]);
    expect(getRandomUserAgent(() => 0.9999)).toBe(USER_AGENTS.at(-1));
  });

  it('monta cabeçalhos de navegador em português', () => {
    const headers = buildBrowserHeaders('UA-teste');
    expect(headers['User-Agent']).toBe('UA-teste');
    expect(headers['Accept-Language']).toMatch(/^pt-BR/);
  });
});
