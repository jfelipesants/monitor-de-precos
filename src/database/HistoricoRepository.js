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
   * Últimas coletas de um produto, da mais antiga para a mais recente
   * (usado no gráfico do e-mail de alerta).
   * @param {string} produtoId
   * @param {number} [limite]
   * @returns {Promise<Array<{ preco: number, coletado_em: string }>>}
   */
  async listarRecentes(produtoId, limite = 14) {
    const dados = await executar(
      this.client
        .from('historico_precos')
        .select('preco, coletado_em')
        .eq('produto_id', produtoId)
        .order('coletado_em', { ascending: false })
        .limit(limite),
      'listar coletas recentes',
    );
    return (dados ?? [])
      .map((r) => ({ preco: Number(r.preco), coletado_em: r.coletado_em }))
      .reverse();
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
