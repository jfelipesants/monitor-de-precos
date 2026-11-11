import { PlaywrightScraper } from '../PlaywrightScraper.js';

/**
 * Amazon: página dinâmica e com proteção anti-bot agressiva.
 * Usa Playwright (navegador real) e detecta a página de captcha.
 *
 * Observação: mesmo com navegador real, a Amazon pode exigir captcha.
 * Nesse caso o produto falha com BlockedError e os demais seguem normalmente.
 */
export class AmazonScraper extends PlaywrightScraper {
  static loja = 'amazon';
  static dominios = ['amazon.com.br', 'amazon.com'];
  static seletores = {
    titulo: ['#productTitle'],
    preco: [
      '#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen',
      '#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen',
      '#priceblock_dealprice',
      '#priceblock_ourprice',
      '.a-price:not(.a-text-price) .a-offscreen',
    ],
    precoOriginal: [
      '#corePriceDisplay_desktop_feature_div .a-text-price .a-offscreen',
      '.basisPrice .a-offscreen',
    ],
    indisponivel: ['#outOfStock', '#availability .a-color-price'],
  };

  detectarBloqueio(html) {
    return /validateCaptcha|Type the characters you see|Digite os caracteres|api-services-support@amazon\.com/i.test(
      html,
    );
  }
}
