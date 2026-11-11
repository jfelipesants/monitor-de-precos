import { describe, expect, it } from 'vitest';
import { formatBRL, parsePrice } from '../../../src/utils/parsePrice.js';

describe('parsePrice', () => {
  it.each([
    ['R$ 1.299,90', 1299.9],
    ['R$ 1.299,90', 1299.9],
    ['1.299', 1299],
    ['1.299.000', 1299000],
    ['29,9', 29.9],
    ['29,90', 29.9],
    ['1299.90', 1299.9],
    ['1299.9', 1299.9],
    ['1299', 1299],
    ['1,299.90', 1299.9],
    ['  R$ 49,99 à vista ', 49.99],
    ['.99', 0.99],
    ['10,', 10],
  ])('converte %j em %d', (entrada, esperado) => {
    expect(parsePrice(entrada)).toBe(esperado);
  });

  it('aceita números e arredonda para 2 casas', () => {
    expect(parsePrice(1899.99)).toBe(1899.99);
    expect(parsePrice(10.006)).toBe(10.01);
  });

  it.each([null, undefined, '', 'Grátis', 'R$ 0,00', 0, -10, Number.NaN, Infinity, {}, '..,'])(
    'retorna null para valor inválido: %j',
    (entrada) => {
      expect(parsePrice(entrada)).toBeNull();
    },
  );
});

describe('formatBRL', () => {
  it('formata no padrão brasileiro', () => {
    expect(formatBRL(1299.9)).toMatch(/^R\$\s1\.299,90$/);
  });
});
