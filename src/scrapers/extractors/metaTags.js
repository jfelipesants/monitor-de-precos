import { parsePrice } from '../../utils/parsePrice.js';
import { interpretarDisponibilidade } from './jsonLd.js';

const SELETORES_PRECO = [
  'meta[property="product:price:amount"]',
  'meta[property="og:price:amount"]',
  'meta[itemprop="price"]',
  '[itemprop="price"][content]',
];

const SELETORES_DISPONIBILIDADE = [
  'meta[property="product:availability"]',
  'meta[property="og:availability"]',
  'link[itemprop="availability"]',
  'meta[itemprop="availability"]',
];

/**
 * Extrai preço de meta tags (Open Graph / microdata).
 * Segunda camada de fallback, depois do JSON-LD.
 *
 * @param {import('cheerio').CheerioAPI} $
 */
export function extrairDeMetaTags($) {
  const preco = primeiroValor($, SELETORES_PRECO, (el) => parsePrice($(el).attr('content')));
  const disponivel = primeiroValor($, SELETORES_DISPONIBILIDADE, (el) =>
    interpretarDisponibilidade($(el).attr('content') ?? $(el).attr('href')),
  );
  const titulo = $('meta[property="og:title"]').attr('content')?.trim() || null;
  const moeda =
    $('meta[property="product:price:currency"]').attr('content') ??
    $('meta[itemprop="priceCurrency"]').attr('content') ??
    null;

  if (preco === null && titulo === null && disponivel === null) return null;

  return { titulo, preco, precoOriginal: null, disponivel, moeda };
}

function primeiroValor($, seletores, extrair) {
  for (const seletor of seletores) {
    for (const el of $(seletor).toArray()) {
      const valor = extrair(el);
      if (valor !== null && valor !== undefined) return valor;
    }
  }
  return null;
}
