import { z } from 'zod';

/** Deve ser idêntico ao enum `public.loja_tipo` do banco. */
export const LOJAS = Object.freeze(['kabum', 'mercado_livre', 'amazon']);

/**
 * O PostgREST pode devolver `numeric` como string ("1299.90").
 * Normaliza para number, preservando null.
 */
const numericoOpcional = z.preprocess(
  (v) => (v === null || v === undefined || v === '' ? null : Number(v)),
  z.number().positive().nullable(),
);

/** Linha da tabela `produtos` como vem do banco. */
export const produtoSchema = z.object({
  id: z.uuid(),
  nome: z.string().min(1),
  url: z.url(),
  loja: z.enum(LOJAS),
  preco_alvo: numericoOpcional,
  ativo: z.boolean(),
  ultimo_preco: numericoOpcional.optional(),
  ultima_coleta: z.string().nullable().optional(),
  ultimo_erro: z.string().nullable().optional(),
});

/** Entrada para cadastrar um produto (CLI). */
export const novoProdutoSchema = z.object({
  nome: z.string().trim().min(2, 'O nome precisa ter ao menos 2 caracteres').max(200),
  url: z.url({ protocol: /^https?$/, message: 'URL inválida (use http ou https)' }),
  loja: z.enum(LOJAS),
  preco_alvo: z.coerce.number().positive('O preço-alvo deve ser positivo').nullable().default(null),
});
