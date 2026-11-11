import { createClient } from '@supabase/supabase-js';
import { DatabaseError } from '../errors/index.js';

/**
 * Cria o cliente Supabase para uso no backend (sem sessão de usuário).
 * @param {{ SUPABASE_URL: string, SUPABASE_SERVICE_ROLE_KEY: string }} config
 */
export function createSupabaseClient({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY }) {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Mensagens amigáveis para códigos comuns do PostgreSQL/PostgREST. */
const MENSAGENS_POR_CODIGO = {
  23505: 'Registro duplicado (violação de chave única)',
  23503: 'Referência inválida (violação de chave estrangeira)',
  23514: 'Valor rejeitado por uma regra (check constraint) do banco',
  '22P02': 'Valor com formato inválido para o tipo da coluna',
  '42P01': 'Tabela não encontrada. Você executou os scripts da pasta database/?',
  PGRST205: 'Tabela/view não encontrada. Você executou os scripts da pasta database/?',
};

/**
 * Converte a resposta `{ data, error }` do Supabase em valor ou DatabaseError.
 *
 * @template T
 * @param {{ data: T, error: any }} resposta
 * @param {string} operacao  descrição para o log, ex.: "listar produtos ativos"
 * @returns {T}
 */
export function unwrap({ data, error }, operacao) {
  if (error) {
    const detalhe = MENSAGENS_POR_CODIGO[error.code] ?? error.message ?? 'erro desconhecido';
    throw new DatabaseError(`Falha ao ${operacao}: ${detalhe}`, {
      cause: error,
      context: { operacao, codigo: error.code, detalhes: error.details, dica: error.hint },
    });
  }
  return data;
}

/**
 * Executa uma query e garante que erros inesperados (ex.: falha de rede do
 * próprio fetch) também virem DatabaseError.
 *
 * @template T
 * @param {PromiseLike<{ data: T, error: any }>} query
 * @param {string} operacao
 * @returns {Promise<T>}
 */
export async function executar(query, operacao) {
  let resposta;
  try {
    resposta = await query;
  } catch (err) {
    throw new DatabaseError(`Falha ao ${operacao}: ${err?.message ?? err}`, {
      cause: err,
      context: { operacao },
      retryable: true,
    });
  }
  return unwrap(resposta, operacao);
}
