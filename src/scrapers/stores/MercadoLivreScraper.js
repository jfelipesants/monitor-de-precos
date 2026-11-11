import { parsePrice } from '../../utils/parsePrice.js';
import { BaseScraper } from '../BaseScraper.js';

/**
 * Mercado Livre: página com JSON-LD e microdata.
 *
 * O preço visível é dividido em dois elementos (reais e centavos),
 * por isso sobrescrevemos `extrairComSeletores` para juntá-los.
 */
export class MercadoLivreScraper extends BaseScraper {
  static loja = 'mercado_livre';
  static dominios = ['mercadolivre.com.br', 'mercadolibre.com'];
  static seletores = {
    titulo: ['h1.ui-pdp-title', 'h1'],
    indisponivel: ['.ui-pdp-warning-message', '.ui-pdp-stock-information__title--out-of-stock'],
  };

  detectarBloqueio(html) {
    // Página de verificação para a qual o ML redireciona tráfego suspeito.
    return /\/gz\/account-verification|suspicious[-_]traffic/i.test(html.slice(0, 20000));
  }

  extrairComSeletores($) {
    const base = super.extrairComSeletores($);

    const preco = this.#lerValorDividido($, '.ui-pdp-price__second-line .andes-money-amount');
    const precoOriginal = this.#lerValorDividido(
      $,
      '.ui-pdp-price__original-value.andes-money-amount, s.andes-money-amount--previous',
    );

    return {
      ...base,
      preco: preco ?? base.preco,
      precoOriginal: precoOriginal ?? base.precoOriginal,
    };
  }

  /** "1.299" + "90" → 1299.9 */
  #lerValorDividido($, seletor) {
    const el = $(seletor).first();
    if (el.length === 0) return null;

    const reais = el.find('.andes-money-amount__fraction').first().text().trim();
    if (!reais) return null;
    const centavos = el.find('.andes-money-amount__cents').first().text().trim();

    return parsePrice(centavos ? `${reais},${centavos.padEnd(2, '0')}` : reais);
  }
}
