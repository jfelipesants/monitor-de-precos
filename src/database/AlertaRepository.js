import { ValidationError } from '../errors/index.js';
import { novoAlertaSchema } from '../schemas/alerta.schema.js';
import { executar } from './supabaseClient.js';

export class AlertaRepository {
  /** @param {import('@supabase/supabase-js').SupabaseClient} client */
  constructor(client) {
    this.client = client;
  }

  /**
   * @param {{ produto_id: string, tipo: string, preco: number, preco_referencia: number|null, canais: string[] }} alerta
   */
  async registrar(alerta) {
    const validado = novoAlertaSchema.safeParse(alerta);
    if (!validado.success) {
      throw new ValidationError('Alerta inválido', {
        context: { problemas: validado.error.issues },
      });
    }
    await executar(this.client.from('alertas').insert(validado.data), 'registrar alerta');
  }

  /**
   * Último alerta de um tipo para um produto (usado no cooldown).
   * @param {string} produtoId
   * @param {string} tipo
   * @returns {Promise<{ preco: number, enviado_em: string } | null>}
   */
  async ultimoAlerta(produtoId, tipo) {
    const dados = await executar(
      this.client
        .from('alertas')
        .select('preco, enviado_em')
        .eq('produto_id', produtoId)
        .eq('tipo', tipo)
        .order('enviado_em', { ascending: false })
        .limit(1)
        .maybeSingle(),
      'consultar último alerta',
    );
    return dados ? { preco: Number(dados.preco), enviado_em: dados.enviado_em } : null;
  }
}
