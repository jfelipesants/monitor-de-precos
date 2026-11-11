import { describe, expect, it, vi } from 'vitest';
import { NotificationError } from '../../../src/errors/index.js';
import { EmailChannel } from '../../../src/notifications/channels/EmailChannel.js';
import { NotificationService } from '../../../src/notifications/NotificationService.js';
import {
  CORES,
  escapeHtml,
  explicarMotivo,
  montarGrafico,
  renderizarAlertaEmail,
  separarPreco,
  tituloDoAlerta,
} from '../../../src/notifications/templates/alertaTemplate.js';
import { criarLoggerFalso } from '../../helpers/index.js';

const alerta = {
  produto: {
    nome: 'Placa de Vídeo RTX 4060',
    url: 'https://www.kabum.com.br/produto/1',
    loja: 'kabum',
    preco_alvo: 1500,
  },
  precoAtual: 1399.9,
  precoOriginal: 1799.9,
  motivos: [
    {
      tipo: 'meta_atingida',
      descricao: 'O preço atingiu a sua meta',
      precoReferencia: 1500,
      variacaoPercentual: -6.67,
    },
  ],
  estatisticas: { media: 1650, minimoHistorico: 1450 },
};

const historico = [1799.9, 1650, 1599, 1520, 1399.9].map((preco, i) => ({
  preco,
  coletado_em: new Date(Date.UTC(2026, 10, 8 + i, 12)).toISOString(),
}));

describe('renderizarAlertaEmail', () => {
  it('monta assunto, HTML e texto com preços formatados', () => {
    const { assunto, html, texto } = renderizarAlertaEmail(alerta);

    expect(assunto).toMatch(/^Chegou na sua meta: Placa de Vídeo RTX 4060 por R\$\s1\.399,90$/);
    expect(html).toContain('Preço na Kabum');
    expect(html).toContain('Abrir na Kabum');
    expect(html).toMatch(/Era <span[^>]*>R\$\s1\.799,90<\/span>/);
    expect(html).toMatch(/Você economiza <strong[^>]*>R\$\s400,00<\/strong> \(22%\)/);
    expect(html).toContain('href="https://www.kabum.com.br/produto/1"');
    expect(texto).toContain('Abaixo da sua meta. Sua meta era R$');
    expect(texto).toContain('Abrir na Kabum: https://www.kabum.com.br/produto/1');
  });

  it('mostra o preço no estilo etiqueta: R$, reais e centavos separados', () => {
    expect(separarPreco(1399.9)).toEqual({ reais: '1.399', centavos: '90' });
    expect(separarPreco(5)).toEqual({ reais: '5', centavos: '00' });
    const { html } = renderizarAlertaEmail(alerta);
    expect(html).toMatch(/class="preco-reais"[^>]*>1\.399<\/td>/);
    expect(html).toMatch(/class="preco-centavos"[^>]*>,90<\/td>/);
  });

  it('inclui um resumo invisível para a prévia da caixa de entrada', () => {
    const { html } = renderizarAlertaEmail(alerta);
    expect(html).toMatch(/display:none[^>]*>Agora por R\$\s1\.399,90 na Kabum\./);
  });

  it('escolhe o título pelo motivo mais forte', () => {
    expect(tituloDoAlerta([{ tipo: 'queda_media' }, { tipo: 'meta_atingida' }])).toBe(
      'Chegou na sua meta',
    );
    expect(tituloDoAlerta([{ tipo: 'queda_media' }, { tipo: 'menor_preco_historico' }])).toBe(
      'Menor preço já registrado',
    );
    expect(tituloDoAlerta([{ tipo: 'queda_media' }])).toBe('Bem abaixo do preço normal');
    expect(tituloDoAlerta([])).toBe('O preço caiu');
  });

  it('explica cada motivo em linguagem simples', () => {
    expect(explicarMotivo({ tipo: 'meta_atingida', precoReferencia: 1500 }, 1500).detalhe).toMatch(
      /exatamente na sua meta/,
    );
    expect(
      explicarMotivo(
        { tipo: 'queda_media', precoReferencia: 2000, variacaoPercentual: -12.4 },
        1752,
      ).titulo,
    ).toBe('12% abaixo da média');
    expect(
      explicarMotivo({ tipo: 'menor_preco_historico', precoReferencia: 1450 }, 1400).detalhe,
    ).toMatch(/R\$\s1\.450,00/);
    expect(explicarMotivo({ tipo: 'outro', descricao: 'X' }, 1)).toEqual({
      titulo: 'X',
      detalhe: '',
    });
  });

  it('desenha o gráfico com uma coluna por coleta e a linha da meta', () => {
    const grafico = montarGrafico(historico, 1500);
    expect(grafico.match(/<td valign="bottom"/g)).toHaveLength(5);
    expect(grafico).toContain('Sua meta, R$');
    expect(grafico).toContain(CORES.etiqueta); // a coleta atual é destacada
    expect(grafico).toContain('08/11'); // data da primeira coleta

    // Toda coluna soma exatamente a altura do gráfico.
    for (const coluna of grafico.match(/<td valign="bottom"[\s\S]*?<\/td>/g)) {
      const alturas = [...coluna.matchAll(/<div style="height:(\d+)px/g)].map((m) => Number(m[1]));
      expect(alturas.reduce((a, b) => a + b, 0)).toBe(96);
    }
  });

  it('desenha o gráfico sem meta e com preços iguais', () => {
    const plano = historico.map((h) => ({ ...h, preco: 100 }));
    const grafico = montarGrafico(plano, null);
    expect(grafico).not.toContain('Sua meta');
    expect(grafico.match(/<td valign="bottom"/g)).toHaveLength(5);
  });

  it('omite o gráfico com menos de 3 coletas', () => {
    expect(montarGrafico(historico.slice(0, 2), 1500)).toBe('');
    expect(montarGrafico(undefined, 1500)).toBe('');
    expect(renderizarAlertaEmail({ ...alerta, historico: [] }).html).not.toContain(
      'Como o preço andou',
    );
    expect(renderizarAlertaEmail({ ...alerta, historico }).html).toContain('Como o preço andou');
  });

  it('não repete no painel de números o que os motivos já mostraram', () => {
    const { html } = renderizarAlertaEmail(alerta);
    expect(html).not.toMatch(/>Sua meta<\/div>/); // já explicada no motivo "meta"
    expect(html).toMatch(/>Média de 30 dias<\/div>/);
    expect(html).toMatch(/>Menor preço anterior<\/div>/);
  });

  it('informa quando o preço foi coletado, no horário de Brasília', () => {
    const { html, texto } = renderizarAlertaEmail({
      ...alerta,
      coletadoEm: '2026-11-11T06:08:00Z',
    });
    expect(html).toContain('Preço coletado em 11/11 às 03:08, horário de Brasília.');
    expect(texto).toContain('Preço coletado em 11/11 às 03:08');
  });

  it('escapa HTML vindo do site da loja (previne injeção)', () => {
    const { html } = renderizarAlertaEmail({
      ...alerta,
      produto: { ...alerta.produto, nome: '<script>alert(1)</script>' },
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('não permite links com protocolo perigoso', () => {
    const { html } = renderizarAlertaEmail({
      ...alerta,
      produto: { ...alerta.produto, url: 'javascript:alert(1)' },
    });
    expect(html).toContain('href="#"');
  });

  it('abrevia nomes longos no assunto e omite campos ausentes', () => {
    const { assunto, html } = renderizarAlertaEmail({
      ...alerta,
      produto: { ...alerta.produto, nome: 'A'.repeat(100), preco_alvo: null },
      precoOriginal: null,
      estatisticas: undefined,
    });
    expect(assunto).toMatch(/: A{47}… por R\$/);
    expect(html).not.toContain('Média de 30 dias');
    expect(html).not.toContain('line-through');
    expect(html).not.toContain('Preço coletado');
  });

  it('escapeHtml trata todos os caracteres especiais', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
    expect(escapeHtml(null)).toBe('');
  });
});

describe('EmailChannel', () => {
  const criarCanal = (transporter) =>
    new EmailChannel({ transporter, from: 'Monitor <eu@gmail.com>', to: 'eu@gmail.com' });

  it('envia o e-mail com HTML e texto', async () => {
    const transporter = { sendMail: vi.fn().mockResolvedValue({ messageId: 'abc' }) };
    await expect(criarCanal(transporter).enviar(alerta)).resolves.toEqual({ id: 'abc' });

    const mensagem = transporter.sendMail.mock.calls[0][0];
    expect(mensagem).toMatchObject({ from: 'Monitor <eu@gmail.com>', to: 'eu@gmail.com' });
    expect(mensagem.subject).toContain('RTX 4060');
    expect(mensagem.html).toContain('<!doctype html>');
    expect(mensagem.text).toBeTruthy();
  });

  it('converte falha do SMTP em NotificationError', async () => {
    const falha = Object.assign(new Error('Invalid login'), { code: 'EAUTH' });
    const transporter = { sendMail: vi.fn().mockRejectedValue(falha) };
    const erro = await criarCanal(transporter)
      .enviar(alerta)
      .catch((e) => e);

    expect(erro).toBeInstanceOf(NotificationError);
    expect(erro.cause).toBe(falha);
    expect(erro.context).toMatchObject({ canal: 'email', codigo: 'EAUTH' });
  });

  it('verificar() explica o problema de autenticação', async () => {
    const transporter = {
      sendMail: vi.fn(),
      verify: vi.fn().mockRejectedValue(new Error('535 auth')),
    };
    await expect(criarCanal(transporter).verificar()).rejects.toThrow(/senha de app/);
  });

  it('fromConfig cria o transporter a partir do .env', () => {
    const canal = EmailChannel.fromConfig({
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: 465,
      SMTP_SECURE: true,
      SMTP_USER: 'eu@gmail.com',
      SMTP_PASS: 'x',
      EMAIL_TO: 'destino@gmail.com',
    });
    expect(canal.from).toBe('"Monitor de Preços" <eu@gmail.com>');
    expect(canal.to).toBe('destino@gmail.com');
    expect(typeof canal.transporter.sendMail).toBe('function');
  });
});

describe('NotificationService', () => {
  const canal = (nome, enviar) => ({ nome, enviar });

  it('envia por todos os canais', async () => {
    const a = canal('email', vi.fn().mockResolvedValue());
    const b = canal('outro', vi.fn().mockResolvedValue());
    const resultado = await new NotificationService({ canais: [a, b] }).notificar(alerta);

    expect(resultado).toEqual({ enviados: ['email', 'outro'], falhas: [] });
    expect(a.enviar).toHaveBeenCalledWith(alerta);
  });

  it('a falha de um canal não impede os outros', async () => {
    const logger = criarLoggerFalso();
    const resultado = await new NotificationService({
      canais: [
        canal('email', vi.fn().mockRejectedValue(new Error('SMTP fora'))),
        canal('outro', vi.fn().mockResolvedValue()),
      ],
      logger,
    }).notificar(alerta);

    expect(resultado).toEqual({
      enviados: ['outro'],
      falhas: [{ canal: 'email', erro: 'SMTP fora' }],
    });
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('avisa quando não há canais configurados', async () => {
    const logger = criarLoggerFalso();
    await expect(new NotificationService({ logger }).notificar(alerta)).resolves.toEqual({
      enviados: [],
      falhas: [],
    });
    expect(logger.warn).toHaveBeenCalled();
  });
});
