import { parsePrice } from '../../utils/parsePrice.js';
import { BaseScraper } from '../BaseScraper.js';

/**
 * Kabum: página server-side (Next.js) com JSON-LD de produto.
 * Axios + Cheerio são suficientes (rápido e leve).
 *
 * O JSON-LD traz só o preço à vista. O preço "de" (riscado) vem dos dados
 * internos do Next.js (`__NEXT_DATA__`) ou, como reserva, do <span> riscado.
 */
export class KabumScraper extends BaseScraper {
  static loja = 'kabum';
  static dominios = ['kabum.com.br'];
  static seletores = {
    titulo: ['h1'],
    // Seletores do layout antigo mantidos como reserva.
    preco: ['h4.finalPrice', '[class*="finalPrice"]'],
    // "line-through" é a classe que desenha o preço riscado no layout atual.
    precoOriginal: ['span.line-through', '[class*="oldPrice"]'],
    indisponivel: ['#formularioProdutoIndisponivel'],
  };

  extrairComSeletores($) {
    const base = super.extrairComSeletores($);
    const precos = this.#lerPrecosNextData($);
    if (!precos) return base;

    return {
      ...base,
      // priceWithDiscount = à vista (PIX); price = parcelado no cartão.
      preco: parsePrice(precos.priceWithDiscount) ?? parsePrice(precos.price) ?? base.preco,
      precoOriginal: parsePrice(precos.oldPrice) ?? base.precoOriginal,
    };
  }

  /**
   * Lê `props.pageProps.product.prices` do JSON que o Next.js embute na página.
   * Retorna null se o bloco não existir ou estiver malformado.
   */
  #lerPrecosNextData($) {
    const bruto = $('script#__NEXT_DATA__').text();
    if (!bruto) return null;
    try {
      return JSON.parse(bruto)?.props?.pageProps?.product?.prices ?? null;
    } catch {
      return null;
    }
  }
}
