import { describe, expect, it } from 'vitest';
import {
  AppError,
  BlockedError,
  mensagemDeErro,
  ScraperError,
  ValidationError,
} from '../../src/errors/index.js';
import { validarResultadoScrape } from '../../src/schemas/scrapeResult.schema.js';

describe('validarResultadoScrape', () => {
  const valido = { titulo: 'X', preco: 100, precoOriginal: 150, disponivel: true, moeda: 'BRL' };

  it('aceita um resultado válido', () => {
    expect(validarResultadoScrape(valido)).toEqual(valido);
  });

  it('descarta preço original menor ou igual ao atual', () => {
    expect(validarResultadoScrape({ ...valido, precoOriginal: 90 }).precoOriginal).toBeNull();
    expect(validarResultadoScrape({ ...valido, precoOriginal: 100 }).precoOriginal).toBeNull();
  });

  it('aplica moeda padrão BRL', () => {
    const { moeda: _m, ...semMoeda } = valido;
    expect(validarResultadoScrape(semMoeda).moeda).toBe('BRL');
  });

  it.each([
    [{ preco: 0 }],
    [{ preco: -1 }],
    [{ preco: Number.NaN }],
    [{ preco: 20_000_000 }],
    [{ disponivel: 'sim' }],
  ])('rejeita %j com ValidationError e contexto', (alteracao) => {
    const fn = () => validarResultadoScrape({ ...valido, ...alteracao }, { url: 'https://x' });
    expect(fn).toThrow(ValidationError);
    try {
      fn();
    } catch (err) {
      expect(err.context.url).toBe('https://x');
    }
  });
});

describe('erros da aplicação', () => {
  it('preservam nome, causa, contexto e herança', () => {
    const causa = new Error('original');
    const erro = new BlockedError('bloqueado', {
      cause: causa,
      context: { status: 403 },
      retryable: true,
    });

    expect(erro).toBeInstanceOf(ScraperError);
    expect(erro).toBeInstanceOf(AppError);
    expect(erro.name).toBe('BlockedError');
    expect(erro.cause).toBe(causa);
    expect(erro.toJSON()).toEqual({
      name: 'BlockedError',
      message: 'bloqueado',
      retryable: true,
      context: { status: 403 },
    });
  });

  it('usam padrões seguros', () => {
    const erro = new AppError('x');
    expect(erro.retryable).toBe(false);
    expect(erro.context).toEqual({});
    expect('cause' in erro).toBe(false);
  });

  it('mensagemDeErro lida com qualquer valor lançado', () => {
    expect(mensagemDeErro(new Error('a'))).toBe('a');
    expect(mensagemDeErro('b')).toBe('b');
  });
});
