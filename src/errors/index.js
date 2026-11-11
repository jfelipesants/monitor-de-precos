/**
 * Hierarquia de erros da aplicação.
 *
 * Todo erro "esperado" herda de AppError e carrega:
 *  - `retryable`: indica se vale a pena tentar de novo (ex.: timeout, HTTP 503);
 *  - `context`:   dados extras para o log (url, status, produtoId...);
 *  - `cause`:     o erro original (padrão nativo do ES2022).
 */
export class AppError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown, context?: Record<string, unknown>, retryable?: boolean }} [options]
   */
  constructor(message, { cause, context = {}, retryable = false } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.context = context;
    this.retryable = retryable;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      retryable: this.retryable,
      context: this.context,
    };
  }
}

/** Variável de ambiente ausente/inválida ou dependência opcional não instalada. */
export class ConfigError extends AppError {}

/** Falha genérica ao obter a página (rede, timeout, HTTP inesperado). */
export class ScraperError extends AppError {}

/** A loja bloqueou a requisição (captcha, 403, 429). */
export class BlockedError extends ScraperError {}

/** A página foi obtida, mas não foi possível extrair o preço. Não adianta repetir. */
export class ParseError extends ScraperError {}

/** O produto está indisponível/esgotado e a página não exibe preço. */
export class ProdutoIndisponivelError extends ScraperError {}

/** Nenhum scraper registrado atende ao domínio da URL. */
export class UnsupportedStoreError extends AppError {}

/** Dado não passou na validação do Zod. */
export class ValidationError extends AppError {}

/** Erro retornado pelo Supabase/PostgREST. */
export class DatabaseError extends AppError {}

/** Falha ao enviar notificação. */
export class NotificationError extends AppError {}

/**
 * Converte qualquer valor lançado em uma mensagem legível.
 * @param {unknown} err
 */
export function mensagemDeErro(err) {
  if (err instanceof Error) return err.message;
  return String(err);
}
