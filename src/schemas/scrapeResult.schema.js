import { z } from 'zod';
import { ValidationError } from '../errors/index.js';

/**
 * Contrato que todo scraper precisa cumprir.
 * Garante que nenhum dado "estranho" (preço negativo, NaN, absurdo)
 * chegue ao banco de dados.
 */
export const scrapeResultSchema = z
  .object({
    titulo: z.string().trim().min(1).max(500).nullable(),
    preco: z.number().finite().positive().max(10_000_000, 'Preço acima do limite plausível'),
    precoOriginal: z.number().finite().positive().nullable(),
    disponivel: z.boolean(),
    moeda: z.string().length(3).default('BRL'),
  })
  .transform((r) => ({
    ...r,
    // Um "preço original" menor que o preço atual não faz sentido; descarta.
    precoOriginal: r.precoOriginal !== null && r.precoOriginal > r.preco ? r.precoOriginal : null,
  }));

/**
 * Valida a saída de um scraper.
 * @param {unknown} dados
 * @param {Record<string, unknown>} [context]
 */
export function validarResultadoScrape(dados, context = {}) {
  const resultado = scrapeResultSchema.safeParse(dados);
  if (!resultado.success) {
    const detalhes = resultado.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new ValidationError(`Resultado do scraper inválido (${detalhes})`, {
      context: { ...context, dados },
    });
  }
  return resultado.data;
}
