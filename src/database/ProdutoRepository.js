import { z } from 'zod';
import { ValidationError } from '../errors/index.js';
import { novoProdutoSchema, produtoSchema } from '../schemas/produto.schema.js';
import { executar } from './supabaseClient.js';

const TABELA = 'produtos';

export class ProdutoRepository {
  /** @param {import('@supabase/supabase-js').SupabaseClient} client */
  constructor(client) {
    this.client = client;
  }

  /** Produtos com `ativo = true`, validados pelo Zod. */
  async listarAtivos() {
    const dados = await executar(
      this.client.from(TABELA).select('*').eq('ativo', true).order('created_at'),
      'listar produtos ativos',
    );
    return this.#validarLista(dados ?? []);
  }

  async listarTodos() {
    const dados = await executar(
      this.client.from(TABELA).select('*').order('created_at'),
      'listar produtos',
    );
    return this.#validarLista(dados ?? []);
  }

  /**
   * @param {{ nome: string, url: string, loja: string, preco_alvo?: number | null }} entrada
   */
  async criar(entrada) {
    const validado = novoProdutoSchema.safeParse(entrada);
    if (!validado.success) {
      throw new ValidationError(
        `Dados do produto inválidos: ${validado.error.issues.map((i) => i.message).join('; ')}`,
        { context: { entrada } },
      );
    }
    const dados = await executar(
      this.client.from(TABELA).insert(validado.data).select().single(),
      'cadastrar produto',
    );
    return produtoSchema.parse(dados);
  }

  /** @param {string} id */
  async desativar(id) {
    await executar(
      this.client.from(TABELA).update({ ativo: false }).eq('id', id),
      'desativar produto',
    );
  }

  /**
   * Atualiza os campos de status da última coleta.
   * @param {string} id
   * @param {{ ultimo_preco?: number, ultima_coleta?: string, ultimo_erro?: string | null }} status
   */
  async atualizarStatusColeta(id, status) {
    await executar(
      this.client.from(TABELA).update(status).eq('id', id),
      'atualizar status da coleta',
    );
  }

  #validarLista(dados) {
    const resultado = z.array(produtoSchema).safeParse(dados);
    if (!resultado.success) {
      throw new ValidationError('Dados de produtos retornados pelo banco são inválidos', {
        context: { problemas: resultado.error.issues.slice(0, 5) },
      });
    }
    return resultado.data;
  }
}
