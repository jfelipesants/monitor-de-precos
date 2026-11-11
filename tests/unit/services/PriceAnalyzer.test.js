import { describe, expect, it } from 'vitest';
import {
  analisarPreco,
  calcularVariacao,
  estaEmCooldown,
} from '../../../src/services/PriceAnalyzer.js';

const base = {
  precoAlvo: null,
  estatisticas: { amostras: 10, media: 1000, minimoHistorico: 850 },
  limiarQueda: 0.1,
  minAmostras: 5,
};
const tipos = (motivos) => motivos.map((m) => m.tipo);

describe('calcularVariacao', () => {
  it('calcula a variação percentual com 2 casas', () => {
    expect(calcularVariacao(90, 100)).toBe(-10);
    expect(calcularVariacao(1, 3)).toBe(-66.67);
    expect(calcularVariacao(110, 100)).toBe(10);
  });

  it('retorna null sem referência', () => {
    expect(calcularVariacao(10, 0)).toBeNull();
    expect(calcularVariacao(10, null)).toBeNull();
  });
});

describe('analisarPreco', () => {
  it('não gera alerta quando o preço está normal', () => {
    expect(analisarPreco({ ...base, precoAtual: 980 })).toEqual([]);
  });

  it('alerta quando o preço atinge exatamente a meta', () => {
    const motivos = analisarPreco({ ...base, precoAtual: 950, precoAlvo: 950 });
    expect(motivos).toEqual([
      expect.objectContaining({
        tipo: 'meta_atingida',
        precoReferencia: 950,
        variacaoPercentual: 0,
      }),
    ]);
  });

  it('não alerta quando o preço está acima da meta', () => {
    expect(analisarPreco({ ...base, precoAtual: 951, precoAlvo: 950 })).toEqual([]);
  });

  it('alerta queda de pelo menos 10% em relação à média', () => {
    expect(tipos(analisarPreco({ ...base, precoAtual: 900 }))).toEqual(['queda_media']);
    expect(tipos(analisarPreco({ ...base, precoAtual: 901 }))).toEqual([]);
  });

  it('alerta novo menor preço histórico', () => {
    const motivos = analisarPreco({ ...base, precoAtual: 849.99 });
    expect(tipos(motivos)).toEqual(['queda_media', 'menor_preco_historico']);
    expect(motivos[1].precoReferencia).toBe(850);
  });

  it('não considera "menor histórico" quando o preço apenas iguala o mínimo', () => {
    expect(tipos(analisarPreco({ ...base, precoAtual: 850 }))).not.toContain(
      'menor_preco_historico',
    );
  });

  it('ignora comparações estatísticas sem histórico suficiente', () => {
    const motivos = analisarPreco({
      ...base,
      precoAtual: 100,
      precoAlvo: 200,
      estatisticas: { amostras: 4, media: 1000, minimoHistorico: 900 },
    });
    expect(tipos(motivos)).toEqual(['meta_atingida']);
  });

  it('combina todos os motivos aplicáveis', () => {
    const motivos = analisarPreco({ ...base, precoAtual: 800, precoAlvo: 900 });
    expect(tipos(motivos)).toEqual(['meta_atingida', 'queda_media', 'menor_preco_historico']);
  });

  it('lida com produto sem histórico algum', () => {
    const motivos = analisarPreco({
      ...base,
      precoAtual: 100,
      estatisticas: { amostras: 0, media: null, minimoHistorico: null },
    });
    expect(motivos).toEqual([]);
  });
});

describe('estaEmCooldown', () => {
  const agora = new Date('2026-06-10T12:00:00Z');
  const horasAtras = (h) => new Date(agora.getTime() - h * 3_600_000).toISOString();

  it('não está em cooldown se nunca houve alerta', () => {
    expect(estaEmCooldown({ ultimoAlerta: null, precoAtual: 10, cooldownHoras: 24, agora })).toBe(
      false,
    );
  });

  it('suprime alerta repetido com o mesmo preço dentro do período', () => {
    const ultimoAlerta = { preco: 100, enviado_em: horasAtras(2) };
    expect(estaEmCooldown({ ultimoAlerta, precoAtual: 100, cooldownHoras: 24, agora })).toBe(true);
  });

  it('libera o alerta se o preço caiu ainda mais', () => {
    const ultimoAlerta = { preco: 100, enviado_em: horasAtras(2) };
    expect(estaEmCooldown({ ultimoAlerta, precoAtual: 99.9, cooldownHoras: 24, agora })).toBe(
      false,
    );
  });

  it('libera o alerta depois que o período termina', () => {
    const ultimoAlerta = { preco: 100, enviado_em: horasAtras(24) };
    expect(estaEmCooldown({ ultimoAlerta, precoAtual: 100, cooldownHoras: 24, agora })).toBe(false);
  });

  it('cooldown 0 desativa a regra', () => {
    const ultimoAlerta = { preco: 100, enviado_em: horasAtras(0) };
    expect(estaEmCooldown({ ultimoAlerta, precoAtual: 100, cooldownHoras: 0, agora })).toBe(false);
  });
});
