import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import {
  extrairDeJsonLd,
  interpretarDisponibilidade,
} from '../../../src/scrapers/extractors/jsonLd.js';
import { extrairDeMetaTags } from '../../../src/scrapers/extractors/metaTags.js';

const comJsonLd = (...objetos) =>
  cheerio.load(
    objetos
      .map(
        (o) =>
          `<script type="application/ld+json">${typeof o === 'string' ? o : JSON.stringify(o)}</script>`,
      )
      .join(''),
  );

describe('extrairDeJsonLd', () => {
  it('extrai nome, preço, moeda e disponibilidade de um Product', () => {
    const $ = comJsonLd({
      '@type': 'Product',
      name: ' Notebook ',
      offers: {
        '@type': 'Offer',
        price: '3499.90',
        priceCurrency: 'BRL',
        availability: 'https://schema.org/InStock',
      },
    });
    expect(extrairDeJsonLd($)).toEqual({
      titulo: 'Notebook',
      preco: 3499.9,
      precoOriginal: null,
      disponivel: true,
      moeda: 'BRL',
    });
  });

  it('encontra o produto dentro de @graph e de arrays', () => {
    const $ = comJsonLd({
      '@graph': [
        { '@type': 'WebPage' },
        { '@type': ['Product', 'Thing'], name: 'X', offers: { price: 10 } },
      ],
    });
    expect(extrairDeJsonLd($).preco).toBe(10);

    const $2 = comJsonLd([
      { '@type': 'Organization' },
      { '@type': 'Product', name: 'Y', offers: [{ price: 20 }] },
    ]);
    expect(extrairDeJsonLd($2).preco).toBe(20);
  });

  it('suporta AggregateOffer (lowPrice) e priceSpecification', () => {
    const agg = comJsonLd({
      '@type': 'Product',
      offers: { '@type': 'AggregateOffer', lowPrice: 99.5 },
    });
    expect(extrairDeJsonLd(agg).preco).toBe(99.5);

    const spec = comJsonLd({
      '@type': 'Product',
      offers: { priceSpecification: { price: '77,70' } },
    });
    expect(extrairDeJsonLd(spec).preco).toBe(77.7);
  });

  it('ignora blocos JSON malformados e continua procurando', () => {
    const $ = comJsonLd('{ quebrado', { '@type': 'Product', offers: { price: 5 } });
    expect(extrairDeJsonLd($).preco).toBe(5);
  });

  it('retorna null quando não há Product', () => {
    expect(extrairDeJsonLd(comJsonLd({ '@type': 'Organization' }))).toBeNull();
    expect(extrairDeJsonLd(cheerio.load('<p>nada</p>'))).toBeNull();
  });

  it('retorna preço null quando o produto não tem oferta', () => {
    const r = extrairDeJsonLd(comJsonLd({ '@type': 'Product', name: 'Sem oferta' }));
    expect(r).toMatchObject({ titulo: 'Sem oferta', preco: null, disponivel: null });
  });
});

describe('interpretarDisponibilidade', () => {
  it.each([
    ['https://schema.org/InStock', true],
    ['http://schema.org/OutOfStock', false],
    ['SoldOut', false],
    ['in stock', true],
    ['PreOrder', true],
    ['', null],
    [undefined, null],
    ['algo estranho', null],
  ])('%j → %j', (entrada, esperado) => {
    expect(interpretarDisponibilidade(entrada)).toBe(esperado);
  });
});

describe('extrairDeMetaTags', () => {
  it('lê preço e disponibilidade de meta tags Open Graph', () => {
    const $ = cheerio.load(`
      <meta property="og:title" content="Monitor 27" />
      <meta property="product:price:amount" content="1299.00" />
      <meta property="product:price:currency" content="BRL" />
      <meta property="product:availability" content="in stock" />`);
    expect(extrairDeMetaTags($)).toEqual({
      titulo: 'Monitor 27',
      preco: 1299,
      precoOriginal: null,
      disponivel: true,
      moeda: 'BRL',
    });
  });

  it('lê microdata (itemprop)', () => {
    const $ = cheerio.load(`<span itemprop="price" content="59.90">R$ 59,90</span>
      <link itemprop="availability" href="https://schema.org/OutOfStock" />`);
    expect(extrairDeMetaTags($)).toMatchObject({ preco: 59.9, disponivel: false });
  });

  it('retorna null quando não há nada relevante', () => {
    expect(extrairDeMetaTags(cheerio.load('<p>oi</p>'))).toBeNull();
  });
});
