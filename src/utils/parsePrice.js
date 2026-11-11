/**
 * Converte representações de preço em número (reais).
 *
 * Exemplos aceitos:
 *   "R$ 1.299,90" → 1299.9     (formato brasileiro)
 *   "1.299"       → 1299       (milhar brasileiro)
 *   "1299.90"     → 1299.9     (formato JSON-LD / schema.org)
 *   "1,299.90"    → 1299.9     (formato americano)
 *   1299.9        → 1299.9
 *
 * Retorna `null` quando não há um preço positivo reconhecível.
 *
 * @param {unknown} valor
 * @returns {number | null}
 */
export function parsePrice(valor) {
  if (typeof valor === 'number') {
    return Number.isFinite(valor) && valor > 0 ? arredondar(valor) : null;
  }
  if (typeof valor !== 'string') return null;

  const limpo = valor.replace(/[^\d.,]/g, '');
  if (!/\d/.test(limpo)) return null;

  const normalizado = normalizarSeparadores(limpo);
  if (normalizado === null) return null;

  const numero = Number(normalizado);
  return Number.isFinite(numero) && numero > 0 ? arredondar(numero) : null;
}

/** Decide qual caractere é o separador decimal e devolve "1234.56". */
function normalizarSeparadores(texto) {
  const ultimaVirgula = texto.lastIndexOf(',');
  const ultimoPonto = texto.lastIndexOf('.');

  // Ambos presentes: o que aparece por último é o decimal.
  if (ultimaVirgula !== -1 && ultimoPonto !== -1) {
    const decimal = ultimaVirgula > ultimoPonto ? ',' : '.';
    const milhar = decimal === ',' ? '.' : ',';
    return texto.split(milhar).join('').replace(decimal, '.');
  }

  if (ultimaVirgula !== -1) return resolverSeparadorUnico(texto, ',');
  if (ultimoPonto !== -1) return resolverSeparadorUnico(texto, '.');
  return texto;
}

/**
 * Só um tipo de separador presente.
 * - Mais de uma ocorrência → é milhar ("1.299.000").
 * - Exatamente 3 dígitos depois → milhar ("1.299"), padrão brasileiro.
 * - Caso contrário → decimal ("29,9", "1299.90").
 */
function resolverSeparadorUnico(texto, sep) {
  const partes = texto.split(sep);
  if (partes.length > 2) return partes.join('');

  const [inteiro, fracao] = partes;
  if (fracao.length === 3) return inteiro + fracao;
  if (fracao.length === 0) return inteiro;
  return `${inteiro || '0'}.${fracao}`;
}

function arredondar(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Formata número como moeda brasileira: 1299.9 → "R$ 1.299,90".
 * @param {number} valor
 */
export function formatBRL(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}
