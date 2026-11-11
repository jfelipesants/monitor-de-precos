import { ALERTA_TIPOS } from '../schemas/alerta.schema.js';

/**
 * Regras de negócio dos alertas. São funções puras, sem I/O, fáceis de testar.
 */

/**
 * Variação percentual de `atual` em relação a `referencia`.
 * Ex.: calcularVariacao(90, 100) → -10
 */
export function calcularVariacao(atual, referencia) {
  if (!referencia) return null;
  return Math.round(((atual - referencia) / referencia) * 10000) / 100;
}

/**
 * Decide quais motivos de alerta o preço atual dispara.
 *
 * @param {{
 *   precoAtual: number,
 *   precoAlvo: number | null,
 *   estatisticas: { amostras: number, media: number|null, minimoHistorico: number|null },
 *   limiarQueda: number,     // 0.10 = 10%
 *   minAmostras: number,
 * }} params
 * @returns {Array<{ tipo: string, precoReferencia: number|null, variacaoPercentual: number|null, descricao: string }>}
 */
export function analisarPreco({ precoAtual, precoAlvo, estatisticas, limiarQueda, minAmostras }) {
  const motivos = [];

  if (precoAlvo !== null && precoAlvo !== undefined && precoAtual <= precoAlvo) {
    motivos.push({
      tipo: ALERTA_TIPOS.META_ATINGIDA,
      precoReferencia: precoAlvo,
      variacaoPercentual: calcularVariacao(precoAtual, precoAlvo),
      descricao: 'O preço atingiu a sua meta',
    });
  }

  // Comparações estatísticas só fazem sentido com histórico suficiente.
  const historicoSuficiente = estatisticas.amostras >= minAmostras;

  if (historicoSuficiente && estatisticas.media) {
    const limite = estatisticas.media * (1 - limiarQueda);
    if (precoAtual <= limite) {
      motivos.push({
        tipo: ALERTA_TIPOS.QUEDA_MEDIA,
        precoReferencia: estatisticas.media,
        variacaoPercentual: calcularVariacao(precoAtual, estatisticas.media),
        descricao: `Preço ao menos ${Math.round(limiarQueda * 100)}% abaixo da média dos últimos 30 dias`,
      });
    }
  }

  if (
    historicoSuficiente &&
    estatisticas.minimoHistorico &&
    precoAtual < estatisticas.minimoHistorico
  ) {
    motivos.push({
      tipo: ALERTA_TIPOS.MENOR_PRECO_HISTORICO,
      precoReferencia: estatisticas.minimoHistorico,
      variacaoPercentual: calcularVariacao(precoAtual, estatisticas.minimoHistorico),
      descricao: 'Menor preço já registrado',
    });
  }

  return motivos;
}

/**
 * Evita spam: não repete o mesmo tipo de alerta dentro do período de cooldown,
 * EXCETO se o preço caiu ainda mais desde o último alerta.
 *
 * @param {{
 *   ultimoAlerta: { preco: number, enviado_em: string } | null,
 *   precoAtual: number,
 *   cooldownHoras: number,
 *   agora?: Date,
 * }} params
 */
export function estaEmCooldown({ ultimoAlerta, precoAtual, cooldownHoras, agora = new Date() }) {
  if (!ultimoAlerta || cooldownHoras <= 0) return false;

  const horasDesde = (agora.getTime() - new Date(ultimoAlerta.enviado_em).getTime()) / 3_600_000;
  if (horasDesde >= cooldownHoras) return false;

  return precoAtual >= ultimoAlerta.preco;
}
