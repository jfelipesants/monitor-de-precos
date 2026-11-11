import { formatBRL } from '../../utils/parsePrice.js';

const NOMES_LOJA = {
  kabum: 'Kabum',
  mercado_livre: 'Mercado Livre',
  amazon: 'Amazon',
};

/** Escapa texto vindo de sites externos antes de inserir no HTML. */
export function escapeHtml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Só permite links http(s) no botão do e-mail. */
function urlSegura(url) {
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol) ? u.toString() : '#';
  } catch {
    return '#';
  }
}

const formatarVariacao = (v) =>
  v === null || v === undefined ? '' : `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')}%`;

/**
 * Monta o conteúdo do e-mail de alerta (HTML + texto puro).
 *
 * @param {{
 *   produto: { nome: string, url: string, loja: string, preco_alvo: number|null },
 *   precoAtual: number,
 *   precoOriginal: number|null,
 *   motivos: Array<{ tipo: string, descricao: string, precoReferencia: number|null, variacaoPercentual: number|null }>,
 *   estatisticas?: { media: number|null, minimoHistorico: number|null },
 * }} alerta
 */
export function renderizarAlertaEmail(alerta) {
  const { produto, precoAtual, precoOriginal, motivos, estatisticas = {} } = alerta;
  const loja = NOMES_LOJA[produto.loja] ?? produto.loja;
  const nome = produto.nome;

  const assunto = `🔔 ${formatBRL(precoAtual)} — ${nome.length > 60 ? `${nome.slice(0, 57)}...` : nome}`;

  const linhasMotivos = motivos
    .map(
      (m) => `
        <li style="margin:4px 0">
          <strong>${escapeHtml(m.descricao)}</strong>
          ${m.precoReferencia ? `<span style="color:#555"> (referência: ${formatBRL(m.precoReferencia)} · ${formatarVariacao(m.variacaoPercentual)})</span>` : ''}
        </li>`,
    )
    .join('');

  const linhaInfo = (rotulo, valor) =>
    valor
      ? `<tr><td style="padding:4px 12px 4px 0;color:#555">${rotulo}</td><td style="padding:4px 0"><strong>${valor}</strong></td></tr>`
      : '';

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1f2328">
    <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px">
      <tr><td>
        <p style="margin:0 0 4px;color:#0a7c42;font-size:13px;text-transform:uppercase;letter-spacing:.5px">Alerta de preço · ${escapeHtml(loja)}</p>
        <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${escapeHtml(nome)}</h1>
        <p style="margin:0 0 4px;font-size:32px;font-weight:bold;color:#0a7c42">${formatBRL(precoAtual)}</p>
        ${precoOriginal ? `<p style="margin:0 0 16px;color:#777;text-decoration:line-through">${formatBRL(precoOriginal)}</p>` : ''}
        <ul style="padding-left:20px;margin:16px 0">${linhasMotivos}</ul>
        <table role="presentation" style="margin:16px 0;font-size:14px">
          ${linhaInfo('Sua meta', produto.preco_alvo ? formatBRL(produto.preco_alvo) : null)}
          ${linhaInfo('Média (30 dias)', estatisticas.media ? formatBRL(estatisticas.media) : null)}
          ${linhaInfo('Menor preço anterior', estatisticas.minimoHistorico ? formatBRL(estatisticas.minimoHistorico) : null)}
        </table>
        <a href="${escapeHtml(urlSegura(produto.url))}" style="display:inline-block;background:#0a7c42;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Ver na loja</a>
        <p style="margin:24px 0 0;color:#999;font-size:12px">Enviado automaticamente pelo Monitor de Preços.</p>
      </td></tr>
    </table>
  </body>
</html>`;

  const texto = [
    `Alerta de preço (${loja})`,
    nome,
    '',
    `Preço atual: ${formatBRL(precoAtual)}`,
    ...motivos.map(
      (m) =>
        `- ${m.descricao}${m.precoReferencia ? ` (referência: ${formatBRL(m.precoReferencia)} ${formatarVariacao(m.variacaoPercentual)})` : ''}`,
    ),
    '',
    `Link: ${produto.url}`,
  ].join('\n');

  return { assunto, html, texto };
}
