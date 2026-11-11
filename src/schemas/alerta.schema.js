import { z } from 'zod';

/** Deve ser idêntico ao enum `public.alerta_tipo` do banco. */
export const ALERTA_TIPOS = Object.freeze({
  META_ATINGIDA: 'meta_atingida',
  QUEDA_MEDIA: 'queda_media',
  MENOR_PRECO_HISTORICO: 'menor_preco_historico',
});

/** Linha a ser inserida na tabela `alertas`. */
export const novoAlertaSchema = z.object({
  produto_id: z.uuid(),
  tipo: z.enum(Object.values(ALERTA_TIPOS)),
  preco: z.number().positive(),
  preco_referencia: z.number().positive().nullable(),
  canais: z.array(z.string().min(1)).min(1),
});
