import { executar } from './supabaseClient.js';

const toNumberOrNull = (v) => (v === null || v === undefined ? null : Number(v));

export class HistoricoRepository {
  /** @param {import('@supabase/supabase-js').SupabaseClient} client */
  constructor(client) {
    this.client = client;
  }

  /**
   * @param {{ produto_id: string, preco: number, preco_original?: number | null, disponivel: boolean }} registro
   */
  async registrar(registro) {
    await executar(
      this.client.from('historico_precos').insert(registro),
      'registrar preço no histórico',
    );
  }

  /**
   * Estatísticas da view `v_estatisticas_produto`.
   * @param {string} produtoId
   * @returns {Promise<{ amostras: number, media: number|null, minimo: number|null, minimoHistorico: number|null }>}
   */
  async obterEstatisticas(produtoId) {
    const dados = await executar(
      this.client
        .from('v_estatisticas_produto')
        .select('amostras_30d, media_30d, minimo_30d, minimo_historico')
        .eq('produto_id', produtoId)
        .maybeSingle(),
      'obter estatísticas de preço',
    );

    return {
      amostras: Number(dados?.amostras_30d ?? 0),
      media: toNumberOrNull(dados?.media_30d),
      minimo: toNumberOrNull(dados?.minimo_30d),
      minimoHistorico: toNumberOrNull(dados?.minimo_historico),
    };
  }
}
