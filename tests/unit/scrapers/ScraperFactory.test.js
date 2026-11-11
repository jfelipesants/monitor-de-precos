import { describe, expect, it } from 'vitest';
import { UnsupportedStoreError, ValidationError } from '../../../src/errors/index.js';
import { BaseScraper } from '../../../src/scrapers/BaseScraper.js';
import { ScraperFactory } from '../../../src/scrapers/ScraperFactory.js';
import { AmazonScraper } from '../../../src/scrapers/stores/AmazonScraper.js';
import { KabumScraper } from '../../../src/scrapers/stores/KabumScraper.js';
import { MercadoLivreScraper } from '../../../src/scrapers/stores/MercadoLivreScraper.js';
import { LOJAS } from '../../../src/schemas/produto.schema.js';

describe('ScraperFactory', () => {
  const factory = new ScraperFactory();

  it.each([
    ['https://www.kabum.com.br/produto/1/x', KabumScraper],
    ['https://produto.mercadolivre.com.br/MLB-1-x', MercadoLivreScraper],
    ['https://www.amazon.com.br/dp/B000', AmazonScraper],
  ])('escolhe a estratégia correta para %s', (url, Classe) => {
    expect(factory.obterScraper(url)).toBeInstanceOf(Classe);
  });

  it('reutiliza a mesma instância por loja', () => {
    const a = factory.obterScraper('https://www.kabum.com.br/produto/1');
    const b = factory.obterScraper('https://www.kabum.com.br/produto/2');
    expect(a).toBe(b);
  });

  it('repassa as opções para os scrapers criados', () => {
    const f = new ScraperFactory({ opcoesScraper: { timeoutMs: 999 } });
    expect(f.obterScraper('https://www.kabum.com.br/produto/1').timeoutMs).toBe(999);
  });

  it('detecta a loja pelo domínio', () => {
    expect(factory.detectarLoja('https://www.amazon.com.br/dp/X')).toBe('amazon');
  });

  it('lança UnsupportedStoreError para lojas desconhecidas', () => {
    expect(() => factory.obterScraper('https://www.loja-desconhecida.com/p/1')).toThrow(
      UnsupportedStoreError,
    );
  });

  it('lança ValidationError para URL malformada', () => {
    expect(() => factory.obterScraper('kabum.com.br/sem-protocolo')).toThrow(ValidationError);
  });

  it('permite registrar novas lojas (extensível)', () => {
    class NovaLoja extends BaseScraper {
      static loja = 'nova';
      static dominios = ['nova.com.br'];
    }
    const f = new ScraperFactory().registrar(NovaLoja).registrar(NovaLoja);
    expect(f.obterScraper('https://nova.com.br/p')).toBeInstanceOf(NovaLoja);
    expect(f.lojasSuportadas().filter((l) => l === 'nova')).toHaveLength(1);
  });

  it('as lojas padrão estão sincronizadas com o enum do banco (LOJAS)', () => {
    expect(new ScraperFactory().lojasSuportadas().sort()).toEqual([...LOJAS].sort());
  });
});
