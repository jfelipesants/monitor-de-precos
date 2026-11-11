import { vi } from 'vitest';

/**
 * Mock do cliente Supabase.
 *
 * Reproduz a API encadeável (`from().select().eq()...`) e devolve, em ordem,
 * as respostas configuradas por tabela. Também registra cada chamada para
 * que os testes verifiquem QUAIS operações foram feitas.
 *
 * @example
 *   const supabase = criarSupabaseMock();
 *   supabase.responder('produtos', { data: [...], error: null });
 *   const repo = new ProdutoRepository(supabase.client);
 *   await repo.listarAtivos();
 *   supabase.chamadas[0].ops // [['select','*'], ['eq','ativo',true], ...]
 */
export function criarSupabaseMock() {
  const filas = new Map();
  const chamadas = [];

  function criarQuery(tabela) {
    const registro = { tabela, ops: [] };
    chamadas.push(registro);

    const query = new Proxy(
      {},
      {
        get(_alvo, prop) {
          if (typeof prop === 'symbol') return undefined;
          if (prop === 'then') {
            const proxima = filas.get(tabela)?.shift() ?? { data: null, error: null };
            const promessa =
              proxima instanceof Error ? Promise.reject(proxima) : Promise.resolve(proxima);
            return promessa.then.bind(promessa);
          }
          return (...args) => {
            registro.ops.push([prop, ...args]);
            return query;
          };
        },
      },
    );
    return query;
  }

  return {
    client: { from: vi.fn(criarQuery) },
    chamadas,
    /** Enfileira uma resposta `{ data, error }` (ou um Error para simular falha de rede). */
    responder(tabela, resposta) {
      if (!filas.has(tabela)) filas.set(tabela, []);
      filas.get(tabela).push(resposta);
      return this;
    },
  };
}
