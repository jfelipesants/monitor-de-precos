import { describe, expect, it, vi } from 'vitest';
import { NotificationError } from '../../../src/errors/index.js';
import { EmailChannel } from '../../../src/notifications/channels/EmailChannel.js';
import { NotificationService } from '../../../src/notifications/NotificationService.js';
import {
  escapeHtml,
  renderizarAlertaEmail,
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

describe('renderizarAlertaEmail', () => {
  it('monta assunto, HTML e texto com preços formatados', () => {
    const { assunto, html, texto } = renderizarAlertaEmail(alerta);

    expect(assunto).toMatch(/R\$\s1\.399,90 — Placa de Vídeo RTX 4060/);
    expect(html).toContain('Kabum');
    expect(html).toMatch(/1\.799,90/);
    expect(html).toContain('-6,7%');
    expect(html).toContain('href="https://www.kabum.com.br/produto/1"');
    expect(texto).toContain('O preço atingiu a sua meta');
    expect(texto).toContain('Link: https://www.kabum.com.br/produto/1');
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
    expect(assunto).toMatch(/A{57}\.\.\.$/);
    expect(html).not.toContain('Sua meta');
    expect(html).not.toContain('line-through');
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
