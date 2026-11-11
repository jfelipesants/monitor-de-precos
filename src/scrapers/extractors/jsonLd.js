import { parsePrice } from '../../utils/parsePrice.js';

/**
 * Extrai dados de produto do JSON-LD (schema.org/Product).
 *
 * As lojas publicam esse bloco para o Google montar os "rich results".
 * Por ser um contrato com buscadores, muda bem menos que o layout (HTML/CSS),
 * o que deixa o scraper muito mais estável.
 *
 * @param {import('cheerio').CheerioAPI} $
 * @returns {{ titulo: string|null, preco: number|null, precoOriginal: number|null,
 *            disponivel: boolean|null, moeda: string|null } | null}
 */
export function extrairDeJsonLd($) {
  const nos = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const bruto = $(el).contents().text();
    try {
      nos.push(...achatar(JSON.parse(bruto)));
    } catch {
      // JSON-LD malformado acontece com frequência; ignoramos o bloco.
    }
  });

  const produto = nos.find(ehProduto);
  if (!produto) return null;

  const ofertas = [produto.offers].flat().filter(Boolean);
  const oferta = ofertas.find((o) => precoDaOferta(o) !== null) ?? ofertas[0] ?? {};

  return {
    titulo: typeof produto.name === 'string' ? produto.name.trim() : null,
    preco: precoDaOferta(oferta),
    precoOriginal: null,
    disponivel: interpretarDisponibilidade(oferta.availability),
    moeda: typeof oferta.priceCurrency === 'string' ? oferta.priceCurrency : null,
  };
}

/** Transforma arrays e "@graph" em uma lista plana de nós. */
function achatar(json) {
  if (Array.isArray(json)) return json.flatMap(achatar);
  if (json && typeof json === 'object') {
    return Array.isArray(json['@graph']) ? [json, ...json['@graph'].flatMap(achatar)] : [json];
  }
  return [];
}

function ehProduto(no) {
  const tipo = no?.['@type'];
  return Array.isArray(tipo) ? tipo.includes('Product') : tipo === 'Product';
}

/** Suporta Offer (price), AggregateOffer (lowPrice) e priceSpecification. */
function precoDaOferta(oferta) {
  if (!oferta || typeof oferta !== 'object') return null;
  const especificacao = [oferta.priceSpecification].flat().find(Boolean);
  return (
    parsePrice(oferta.price) ??
    parsePrice(oferta.lowPrice) ??
    parsePrice(especificacao?.price) ??
    null
  );
}

/** "https://schema.org/InStock" → true | ".../OutOfStock" → false | ausente → null */
export function interpretarDisponibilidade(valor) {
  if (typeof valor !== 'string' || valor.trim() === '') return null;
  const v = valor.toLowerCase();
  if (/outofstock|soldout|discontinued|out of stock|indispon/.test(v)) return false;
  if (/instock|in stock|limitedavailability|preorder|onlineonly|dispon/.test(v)) return true;
  return null;
}
