import { BaseScraper } from '../BaseScraper.js';

/**
 * Kabum: página server-side com JSON-LD de produto.
 * Axios + Cheerio são suficientes (rápido e leve).
 */
export class KabumScraper extends BaseScraper {
  static loja = 'kabum';
  static dominios = ['kabum.com.br'];
  static seletores = {
    titulo: ['h1'],
    preco: ['h4.finalPrice', '[class*="finalPrice"]', '[data-testid="price-value"]'],
    precoOriginal: ['span.oldPrice', '[class*="oldPrice"]'],
    indisponivel: ['#formularioProdutoIndisponivel'],
  };
}
