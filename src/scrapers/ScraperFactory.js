import { UnsupportedStoreError, ValidationError } from '../errors/index.js';
import { AmazonScraper } from './stores/AmazonScraper.js';
import { KabumScraper } from './stores/KabumScraper.js';
import { MercadoLivreScraper } from './stores/MercadoLivreScraper.js';

/** Estratégias registradas por padrão. Nova loja? Adicione a classe aqui. */
export const ESTRATEGIAS_PADRAO = Object.freeze([KabumScraper, MercadoLivreScraper, AmazonScraper]);

/**
 * Factory que escolhe a estratégia de scraping a partir do domínio da URL.
 * Cada estratégia é instanciada uma única vez (cache) e reutilizada.
 */
export class ScraperFactory {
  /**
   * @param {{
   *   estrategias?: Array<typeof import('./BaseScraper.js').BaseScraper>,
   *   opcoesScraper?: ConstructorParameters<typeof import('./BaseScraper.js').BaseScraper>[0],
   * }} [options]
   */
  constructor({ estrategias = ESTRATEGIAS_PADRAO, opcoesScraper = {} } = {}) {
    this.estrategias = [...estrategias];
    this.opcoesScraper = opcoesScraper;
    this.instancias = new Map();
  }

  /** Registra uma nova estratégia em tempo de execução. */
  registrar(ClasseScraper) {
    if (!this.estrategias.includes(ClasseScraper)) this.estrategias.push(ClasseScraper);
    return this;
  }

  /** @param {string} url */
  resolverClasse(url) {
    try {
      new URL(url);
    } catch (err) {
      throw new ValidationError(`URL inválida: "${url}"`, { cause: err, context: { url } });
    }

    const Classe = this.estrategias.find((E) => E.supports(url));
    if (!Classe) {
      throw new UnsupportedStoreError(
        `Loja não suportada para a URL "${url}". Suportadas: ${this.lojasSuportadas().join(', ')}`,
        { context: { url } },
      );
    }
    return Classe;
  }

  /** @param {string} url */
  obterScraper(url) {
    const Classe = this.resolverClasse(url);
    if (!this.instancias.has(Classe)) {
      this.instancias.set(Classe, new Classe(this.opcoesScraper));
    }
    return this.instancias.get(Classe);
  }

  /** @param {string} url → ex.: "kabum" */
  detectarLoja(url) {
    return this.resolverClasse(url).loja;
  }

  lojasSuportadas() {
    return this.estrategias.map((E) => E.loja);
  }
}
