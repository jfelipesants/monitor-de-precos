/**
 * Executa `fn` para cada item com no máximo `limit` execuções simultâneas.
 * Assim como Promise.allSettled, nunca rejeita: devolve o status de cada item
 * na mesma ordem da entrada. Uma falha não interrompe as demais.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<PromiseSettledResult<R>[]>}
 */
export async function mapWithConcurrency(items, limit, fn) {
  const resultados = new Array(items.length);
  let proximo = 0;

  async function worker() {
    while (proximo < items.length) {
      const indice = proximo++;
      try {
        resultados[indice] = { status: 'fulfilled', value: await fn(items[indice], indice) };
      } catch (reason) {
        resultados[indice] = { status: 'rejected', reason };
      }
    }
  }

  const totalWorkers = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: totalWorkers }, worker));
  return resultados;
}
