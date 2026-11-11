import { describe, expect, it } from 'vitest';
import { AlertaRepository } from '../../../src/database/AlertaRepository.js';
import { HistoricoRepository } from '../../../src/database/HistoricoRepository.js';
import { ProdutoRepository } from '../../../src/database/ProdutoRepository.js';
import { unwrap } from '../../../src/database/supabaseClient.js';
import { DatabaseError, ValidationError } from '../../../src/errors/index.js';
import { criarSupabaseMock } from '../../mocks/supabase.mock.js';

const ID = '7f1c2a9e-3b4d-4c5e-8f6a-1b2c3d4e5f60';

const linhaProduto = (extra = {}) => ({
  id: ID,
  nome: 'Placa de vídeo',
  url: 'https://www.kabum.com.br/produto/1',
  loja: 'kabum',
  preco_alvo: '1500.00', // PostgREST pode devolver numeric como string
  ativo: true,
  ultimo_preco: null,
  ultima_coleta: null,
  ultimo_erro: null,
  ...extra,
});

describe('unwrap', () => {
  it('devolve os dados quando não há erro', () => {
    expect(unwrap({ data: [1], error: null }, 'testar')).toEqual([1]);
  });

  it('traduz códigos conhecidos do PostgreSQL', () => {
    const fn = () =>
      unwrap(
        { data: null, error: { code: '23505', message: 'duplicate key' } },
        'cadastrar produto',
      );
    expect(fn).toThrow(DatabaseError);
    expect(fn).toThrow('Falha ao cadastrar produto: Registro duplicado');
  });

  it('dá uma dica quando a tabela não existe', () => {
    expect(() =>
      unwrap({ data: null, error: { code: 'PGRST205', message: 'x' } }, 'listar'),
    ).toThrow(/scripts da pasta database/);
  });

  it('usa a mensagem original para códigos desconhecidos', () => {
    expect(() => unwrap({ data: null, error: { code: 'XX', message: 'boom' } }, 'op')).toThrow(
      'Falha ao op: boom',
    );
  });
});

describe('ProdutoRepository', () => {
  it('lista apenas produtos ativos e normaliza numeric', async () => {
    const supabase = criarSupabaseMock().responder('produtos', {
      data: [linhaProduto()],
      error: null,
    });
    const produtos = await new ProdutoRepository(supabase.client).listarAtivos();

    expect(produtos[0].preco_alvo).toBe(1500);
    expect(supabase.client.from).toHaveBeenCalledWith('produtos');
    expect(supabase.chamadas[0].ops).toContainEqual(['eq', 'ativo', true]);
  });

  it('lista todos os produtos', async () => {
    const supabase = criarSupabaseMock().responder('produtos', {
      data: [linhaProduto({ ativo: false })],
      error: null,
    });
    const produtos = await new ProdutoRepository(supabase.client).listarTodos();
    expect(produtos).toHaveLength(1);
    expect(supabase.chamadas[0].ops.some(([op]) => op === 'eq')).toBe(false);
  });

  it('trata data null como lista vazia', async () => {
    const supabase = criarSupabaseMock().responder('produtos', { data: null, error: null });
    await expect(new ProdutoRepository(supabase.client).listarAtivos()).resolves.toEqual([]);
  });

  it('rejeita linhas inválidas vindas do banco', async () => {
    const supabase = criarSupabaseMock().responder('produtos', {
      data: [linhaProduto({ loja: 'loja_x' })],
      error: null,
    });
    await expect(new ProdutoRepository(supabase.client).listarAtivos()).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('converte erro do Supabase em DatabaseError', async () => {
    const supabase = criarSupabaseMock().responder('produtos', {
      data: null,
      error: { code: '42P01', message: 'relation does not exist' },
    });
    await expect(new ProdutoRepository(supabase.client).listarAtivos()).rejects.toThrow(
      DatabaseError,
    );
  });

  it('converte falha de rede em DatabaseError retentável', async () => {
    const supabase = criarSupabaseMock().responder('produtos', new TypeError('fetch failed'));
    const erro = await new ProdutoRepository(supabase.client).listarAtivos().catch((e) => e);
    expect(erro).toBeInstanceOf(DatabaseError);
    expect(erro.retryable).toBe(true);
  });

  it('cadastra produto validando a entrada', async () => {
    const supabase = criarSupabaseMock().responder('produtos', {
      data: linhaProduto(),
      error: null,
    });
    const repo = new ProdutoRepository(supabase.client);

    const produto = await repo.criar({
      nome: '  Placa de vídeo ',
      url: 'https://www.kabum.com.br/produto/1',
      loja: 'kabum',
      preco_alvo: 1500,
    });

    expect(produto.id).toBe(ID);
    const [, payload] = supabase.chamadas[0].ops.find(([op]) => op === 'insert');
    expect(payload).toEqual({
      nome: 'Placa de vídeo',
      url: 'https://www.kabum.com.br/produto/1',
      loja: 'kabum',
      preco_alvo: 1500,
    });
  });

  it('não chama o banco se a entrada for inválida', async () => {
    const supabase = criarSupabaseMock();
    await expect(
      new ProdutoRepository(supabase.client).criar({ nome: 'X', url: 'ftp://x', loja: 'kabum' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(supabase.client.from).not.toHaveBeenCalled();
  });

  it('desativa e atualiza status da coleta', async () => {
    const supabase = criarSupabaseMock();
    const repo = new ProdutoRepository(supabase.client);
    await repo.desativar(ID);
    await repo.atualizarStatusColeta(ID, { ultimo_erro: 'falhou' });

    expect(supabase.chamadas[0].ops).toEqual([
      ['update', { ativo: false }],
      ['eq', 'id', ID],
    ]);
    expect(supabase.chamadas[1].ops).toEqual([
      ['update', { ultimo_erro: 'falhou' }],
      ['eq', 'id', ID],
    ]);
  });
});

describe('HistoricoRepository', () => {
  it('registra um preço', async () => {
    const supabase = criarSupabaseMock();
    const registro = { produto_id: ID, preco: 10, preco_original: null, disponivel: true };
    await new HistoricoRepository(supabase.client).registrar(registro);
    expect(supabase.chamadas[0]).toEqual({
      tabela: 'historico_precos',
      ops: [['insert', registro]],
    });
  });

  it('converte as estatísticas da view em números', async () => {
    const supabase = criarSupabaseMock().responder('v_estatisticas_produto', {
      data: {
        amostras_30d: 12,
        media_30d: '1650.50',
        minimo_30d: '1500.00',
        minimo_historico: '1450.00',
      },
      error: null,
    });
    const est = await new HistoricoRepository(supabase.client).obterEstatisticas(ID);
    expect(est).toEqual({ amostras: 12, media: 1650.5, minimo: 1500, minimoHistorico: 1450 });
  });

  it('devolve estatísticas vazias para produto sem histórico', async () => {
    const supabase = criarSupabaseMock().responder('v_estatisticas_produto', {
      data: null,
      error: null,
    });
    const est = await new HistoricoRepository(supabase.client).obterEstatisticas(ID);
    expect(est).toEqual({ amostras: 0, media: null, minimo: null, minimoHistorico: null });
  });

  it('lista as coletas recentes da mais antiga para a mais nova', async () => {
    const supabase = criarSupabaseMock().responder('historico_precos', {
      data: [
        { preco: '90.00', coletado_em: '2026-11-11T00:00:00Z' },
        { preco: '100.00', coletado_em: '2026-11-10T00:00:00Z' },
      ],
      error: null,
    });
    const lista = await new HistoricoRepository(supabase.client).listarRecentes(ID, 5);

    expect(lista).toEqual([
      { preco: 100, coletado_em: '2026-11-10T00:00:00Z' },
      { preco: 90, coletado_em: '2026-11-11T00:00:00Z' },
    ]);
    expect(supabase.chamadas[0].ops).toContainEqual(['order', 'coletado_em', { ascending: false }]);
    expect(supabase.chamadas[0].ops).toContainEqual(['limit', 5]);
  });

  it('lista vazia quando não há coletas', async () => {
    const supabase = criarSupabaseMock();
    await expect(new HistoricoRepository(supabase.client).listarRecentes(ID)).resolves.toEqual([]);
  });
});

describe('AlertaRepository', () => {
  const alerta = {
    produto_id: ID,
    tipo: 'meta_atingida',
    preco: 1400,
    preco_referencia: 1500,
    canais: ['email'],
  };

  it('registra um alerta válido', async () => {
    const supabase = criarSupabaseMock();
    await new AlertaRepository(supabase.client).registrar(alerta);
    expect(supabase.chamadas[0].ops).toEqual([['insert', alerta]]);
  });

  it('rejeita alerta com tipo inválido', async () => {
    const supabase = criarSupabaseMock();
    await expect(
      new AlertaRepository(supabase.client).registrar({ ...alerta, tipo: 'inventado' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('busca o último alerta por produto e tipo', async () => {
    const supabase = criarSupabaseMock().responder('alertas', {
      data: { preco: '1400.00', enviado_em: '2026-01-01T00:00:00Z' },
      error: null,
    });
    const repo = new AlertaRepository(supabase.client);
    await expect(repo.ultimoAlerta(ID, 'meta_atingida')).resolves.toEqual({
      preco: 1400,
      enviado_em: '2026-01-01T00:00:00Z',
    });
    expect(supabase.chamadas[0].ops).toContainEqual(['eq', 'tipo', 'meta_atingida']);
  });

  it('retorna null quando nunca houve alerta', async () => {
    const supabase = criarSupabaseMock();
    await expect(
      new AlertaRepository(supabase.client).ultimoAlerta(ID, 'queda_media'),
    ).resolves.toBeNull();
  });
});
