import { formatBRL } from '../../utils/parsePrice.js';

/**
 * E-mail de alerta de preço.
 *
 * Conceito visual: a etiqueta amarela de oferta do varejo brasileiro.
 * O preço aparece numa etiqueta (com o furinho de pendurar), seguido dos
 * motivos do alerta e de um gráfico das últimas coletas com a linha da meta.
 *
 * Regras de e-mail (diferentes de páginas web):
 * - estilos INLINE, pois muitos clientes de e-mail removem CSS externo;
 * - layout com <table>, que é o que o Outlook e o Gmail entendem bem;
 * - a fonte Archivo carrega no Apple Mail/iOS; nos demais, cai para a fonte do sistema;
 * - o <style> do <head> só traz melhorias (celular); o e-mail funciona sem ele.
 */

const NOMES_LOJA = {
  kabum: 'Kabum',
  mercado_livre: 'Mercado Livre',
  amazon: 'Amazon',
};

/** Paleta: etiqueta amarela de oferta + tinta azul-marinho. */
export const CORES = Object.freeze({
  fundo: '#E7EBF2',
  papel: '#FFFFFF',
  tinta: '#151E3A',
  tintaSuave: '#59627D',
  painel: '#F3F5F9',
  etiqueta: '#FFD43A',
  barra: '#CBD3E4',
});

const FONTE = "'Archivo', 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif";

/** Título do e-mail conforme o motivo mais forte. */
const TITULOS = {
  meta_atingida: 'Chegou na sua meta',
  menor_preco_historico: 'Menor preço já registrado',
  queda_media: 'Bem abaixo do preço normal',
};
const PRIORIDADE = ['meta_atingida', 'menor_preco_historico', 'queda_media'];

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

const encurtar = (texto, max) =>
  texto.length > max ? `${texto.slice(0, max - 1).trimEnd()}…` : texto;

export function tituloDoAlerta(motivos = []) {
  const tipo = PRIORIDADE.find((t) => motivos.some((m) => m.tipo === t));
  return TITULOS[tipo] ?? 'O preço caiu';
}

/** "11/11" e "03:08" no horário de Brasília. */
function formatarColeta(iso) {
  const data = new Date(iso);
  if (!iso || Number.isNaN(data.getTime())) return null;
  const fmt = (opcoes) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', ...opcoes }).format(data);
  return {
    dia: fmt({ day: '2-digit', month: '2-digit' }),
    hora: fmt({ hour: '2-digit', minute: '2-digit' }),
  };
}

/** Transforma um motivo técnico em título + explicação em linguagem simples. */
export function explicarMotivo(motivo, precoAtual) {
  const ref = motivo.precoReferencia;
  switch (motivo.tipo) {
    case 'meta_atingida': {
      const abaixo = ref - precoAtual;
      return {
        titulo: 'Abaixo da sua meta',
        detalhe:
          abaixo > 0.004
            ? `Sua meta era ${formatBRL(ref)}. O preço ficou ${formatBRL(abaixo)} abaixo dela.`
            : `O preço chegou exatamente na sua meta de ${formatBRL(ref)}.`,
      };
    }
    case 'queda_media': {
      const pct = Math.abs(Math.round(motivo.variacaoPercentual ?? 0));
      return {
        titulo: `${pct}% abaixo da média`,
        detalhe: `Nos últimos 30 dias, este produto custou em média ${formatBRL(ref)}.`,
      };
    }
    case 'menor_preco_historico':
      return {
        titulo: 'O menor preço que já vimos',
        detalhe: `Antes, o menor valor registrado era ${formatBRL(ref)}.`,
      };
    default:
      return { titulo: motivo.descricao ?? 'Preço em queda', detalhe: '' };
  }
}

/* ------------------------------------------------------------------ */
/* Gráfico de barras feito só com HTML (e-mails não executam JS e o    */
/* Gmail não exibe SVG). Cada coleta é uma coluna; a meta é uma linha  */
/* de 2px que atravessa as colunas, com os vãos formando um tracejado. */
/* ------------------------------------------------------------------ */

const ALTURA_GRAFICO = 96;

function bloco(altura, cor, extra = '') {
  if (altura <= 0) return '';
  return `<div style="height:${altura}px;line-height:${altura}px;font-size:0;background:${cor};${extra}">&nbsp;</div>`;
}

export function montarGrafico(historico, meta) {
  const pontos = (historico ?? []).filter((p) => Number.isFinite(p?.preco)).slice(-14);
  if (pontos.length < 3) return '';

  const H = ALTURA_GRAFICO;
  const valores = pontos.map((p) => p.preco);
  const referencias = meta ? [...valores, meta] : valores;
  const menor = Math.min(...referencias);
  const maior = Math.max(...referencias);
  // A base fica bem abaixo do menor valor: a queda aparece sem que a barra
  // mais baixa "suma" (o menor preço ocupa cerca de metade da altura).
  const amplitude = maior - menor || maior * 0.02;
  const base = menor - amplitude;
  const topo = maior + amplitude * 0.1;
  const altura = (v) => Math.min(H, Math.max(6, Math.round(((v - base) / (topo - base)) * H)));

  const linhaMeta = meta ? Math.max(2, altura(meta)) : null;
  const arredondado = 'border-radius:3px 3px 0 0;';

  const colunas = pontos
    .map((p, i) => {
      const atual = i === pontos.length - 1;
      const cor = atual ? CORES.etiqueta : CORES.barra;
      let b = altura(p.preco);
      let pilha;

      if (linhaMeta === null) {
        pilha = bloco(H - b, 'transparent') + bloco(b, cor, arredondado);
      } else if (b <= linhaMeta - 2) {
        // Barra termina abaixo da linha da meta.
        pilha =
          bloco(H - linhaMeta, 'transparent') +
          bloco(2, CORES.tinta) +
          bloco(linhaMeta - 2 - b, 'transparent') +
          bloco(b, cor, arredondado);
      } else {
        // Barra atravessa a linha da meta.
        b = Math.max(b, linhaMeta);
        const acima = b - linhaMeta;
        pilha =
          bloco(H - b, 'transparent') +
          bloco(acima, cor, acima > 0 ? arredondado : '') +
          bloco(2, CORES.tinta) +
          bloco(linhaMeta - 2, cor);
      }

      return `<td valign="bottom" style="padding:0 2px;height:${H}px;">${pilha}</td>`;
    })
    .join('');

  const primeira = formatarColeta(pontos[0].coletado_em);
  const legendaMeta = meta
    ? `<td align="right" style="font-family:${FONTE};font-size:13px;color:${CORES.tintaSuave};white-space:nowrap;">
         <span style="display:inline-block;width:16px;height:2px;background:${CORES.tinta};vertical-align:middle;margin-right:6px;"></span>Sua meta, ${formatBRL(meta)}
       </td>`
    : '';

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0;">
      <tr>
        <td style="font-family:${FONTE};font-size:15px;font-weight:700;color:${CORES.tinta};padding:0 0 14px;">Como o preço andou</td>
        ${legendaMeta}
      </tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">
      <tr>${colunas}</tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${CORES.barra};">
      <tr>
        <td style="font-family:${FONTE};font-size:12px;color:${CORES.tintaSuave};padding:8px 2px 0;">${primeira ? primeira.dia : ''}</td>
        <td align="right" style="font-family:${FONTE};font-size:12px;color:${CORES.tinta};font-weight:700;padding:8px 2px 0;">Agora</td>
      </tr>
    </table>`;
}

/* ------------------------------------------------------------------ */

/**
 * Preço no estilo das etiquetas do varejo brasileiro:
 * "R$" pequeno, reais grandes e centavos menores, alinhados pelo topo.
 * 4277.07 → R$ | 4.277 | ,07
 */
export function separarPreco(valor) {
  const [reais, centavos] = formatBRL(valor)
    .replace(/^R\$\s*/, '')
    .split(',');
  return { reais, centavos: centavos ?? '00' };
}

function montarPrecoEtiqueta(valor) {
  const { reais, centavos } = separarPreco(valor);
  const base = `font-family:${FONTE};color:${CORES.tinta};font-weight:800;line-height:1;font-stretch:85%;`;
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 0;" aria-label="${escapeHtml(formatBRL(valor))}">
      <tr>
        <td class="preco-moeda" valign="top" style="${base}font-size:22px;padding:9px 6px 0 0;">R$</td>
        <td class="preco-reais" valign="top" style="${base}font-size:64px;letter-spacing:-1.8px;white-space:nowrap;">${reais}</td>
        <td class="preco-centavos" valign="top" style="${base}font-size:30px;padding:5px 0 0 2px;">,${centavos}</td>
      </tr>
    </table>`;
}

function montarMotivos(motivos, precoAtual) {
  const linhas = motivos
    .map((m) => {
      const { titulo, detalhe } = explicarMotivo(m, precoAtual);
      return `
      <tr>
        <td width="34" valign="top" style="padding:2px 0 16px;">
          <div style="width:22px;height:22px;line-height:22px;border-radius:11px;background:${CORES.tinta};color:${CORES.etiqueta};font-family:${FONTE};font-size:13px;font-weight:700;text-align:center;">&#10003;</div>
        </td>
        <td valign="top" style="padding:0 0 16px;font-family:${FONTE};">
          <div style="font-size:16px;font-weight:700;color:${CORES.tinta};line-height:1.35;">${escapeHtml(titulo)}</div>
          ${detalhe ? `<div style="font-size:14px;color:${CORES.tintaSuave};line-height:1.5;padding-top:2px;">${escapeHtml(detalhe)}</div>` : ''}
        </td>
      </tr>`;
    })
    .join('');

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0;">
      <tr><td colspan="2" style="font-family:${FONTE};font-size:15px;font-weight:700;color:${CORES.tinta};padding:0 0 16px;">Por que avisamos você</td></tr>
      ${linhas}
    </table>`;
}

/** Painel de números de referência, sem repetir o que os motivos já disseram. */
function montarNumeros(produto, estatisticas, motivos) {
  const jaDito = new Set(motivos.map((m) => m.tipo));
  const itens = [
    ['Sua meta', produto.preco_alvo, 'meta_atingida'],
    ['Média de 30 dias', estatisticas.media, 'queda_media'],
    ['Menor preço anterior', estatisticas.minimoHistorico, 'menor_preco_historico'],
  ].filter(([, valor, tipo]) => valor && !jaDito.has(tipo));

  if (itens.length === 0) return '';

  const celulas = itens
    .map(
      ([rotulo, valor]) => `
      <td class="numero" valign="top" style="padding:16px 18px;font-family:${FONTE};">
        <div style="font-size:13px;color:${CORES.tintaSuave};line-height:1.3;">${rotulo}</div>
        <div style="font-size:17px;font-weight:700;color:${CORES.tinta};padding-top:4px;white-space:nowrap;">${formatBRL(valor)}</div>
      </td>`,
    )
    .join('');

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;background:${CORES.painel};border-radius:12px;">
      <tr>${celulas}</tr>
    </table>`;
}

/**
 * Monta o conteúdo do e-mail de alerta (HTML + texto puro).
 *
 * @param {{
 *   produto: { nome: string, url: string, loja: string, preco_alvo: number|null },
 *   precoAtual: number,
 *   precoOriginal?: number|null,
 *   motivos: Array<{ tipo: string, descricao?: string, precoReferencia: number|null, variacaoPercentual: number|null }>,
 *   estatisticas?: { media?: number|null, minimoHistorico?: number|null },
 *   historico?: Array<{ preco: number, coletado_em: string }>,
 *   coletadoEm?: string,
 * }} alerta
 */
export function renderizarAlertaEmail(alerta) {
  const {
    produto,
    precoAtual,
    precoOriginal = null,
    motivos = [],
    estatisticas = {},
    historico = [],
    coletadoEm,
  } = alerta;

  const loja = NOMES_LOJA[produto.loja] ?? produto.loja;
  const titulo = tituloDoAlerta(motivos);
  const nome = produto.nome;
  const assunto = `${titulo}: ${encurtar(nome, 48)} por ${formatBRL(precoAtual)}`;

  const economia =
    precoOriginal && precoOriginal > precoAtual
      ? {
          valor: precoOriginal - precoAtual,
          pct: Math.round((1 - precoAtual / precoOriginal) * 100),
        }
      : null;

  const preheader = economia
    ? `Agora por ${formatBRL(precoAtual)} na ${loja}. São ${formatBRL(economia.valor)} a menos que o preço anterior da loja.`
    : `Agora por ${formatBRL(precoAtual)} na ${loja}. Veja por que vale a pena olhar.`;

  const coleta = formatarColeta(coletadoEm);

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(assunto)}</title>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&amp;display=swap" rel="stylesheet">
<style>
  body { margin: 0; padding: 0; }
  @media (max-width: 520px) {
    .moldura { padding: 16px 8px 24px !important; }
    .cartao { padding: 28px 20px 24px !important; }
    .titulo { font-size: 24px !important; }
    .etiqueta { padding: 22px 20px 20px !important; }
    .preco-reais { font-size: 50px !important; letter-spacing: -1.2px !important; }
    .preco-moeda { font-size: 18px !important; padding-top: 6px !important; }
    .preco-centavos { font-size: 24px !important; padding-top: 4px !important; }
    .numero { display: block !important; width: auto !important; padding: 12px 16px !important; }
    .botao-tabela { width: 100% !important; }
    .botao, .botao a { display: block !important; text-align: center !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${CORES.fundo};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}${'&#8199;&#65279;&#847; '.repeat(30)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CORES.fundo};">
  <tr>
    <td class="moldura" align="center" style="padding:36px 16px 40px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

        <tr>
          <td style="padding:0 6px 18px;font-family:${FONTE};font-size:15px;font-weight:700;color:${CORES.tinta};">
            <span style="display:inline-block;width:16px;height:11px;background:${CORES.etiqueta};border-radius:3px;vertical-align:-1px;margin-right:8px;"></span>Monitor de Preços
          </td>
        </tr>

        <tr>
          <td class="cartao" style="background:${CORES.papel};border-radius:22px;padding:40px 40px 36px;">

            <h1 class="titulo" style="margin:0;font-family:${FONTE};font-size:30px;line-height:1.15;font-weight:800;letter-spacing:-0.6px;color:${CORES.tinta};">${escapeHtml(titulo)}</h1>
            <p style="margin:10px 0 0;font-family:${FONTE};font-size:16px;line-height:1.5;color:${CORES.tintaSuave};">${escapeHtml(nome)}</p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;background:${CORES.etiqueta};border-radius:18px;">
              <tr>
                <td class="etiqueta" style="padding:26px 28px 26px;">
                  <div style="font-family:${FONTE};font-size:15px;font-weight:600;color:${CORES.tinta};">Preço na ${escapeHtml(loja)}</div>
                  ${montarPrecoEtiqueta(precoAtual)}
                  ${
                    economia
                      ? `<div style="margin:14px 0 0;font-family:${FONTE};font-size:15px;line-height:1.45;color:${CORES.tinta};">Era <span style="text-decoration:line-through;white-space:nowrap;">${formatBRL(precoOriginal)}</span>. Você economiza <strong style="white-space:nowrap;">${formatBRL(economia.valor)}</strong> (${economia.pct}%).</div>`
                      : ''
                  }
                </td>
              </tr>
            </table>

            ${montarMotivos(motivos, precoAtual)}
            ${montarGrafico(historico, produto.preco_alvo)}
            ${montarNumeros(produto, estatisticas, motivos)}

            <table class="botao-tabela" role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 0;">
              <tr>
                <td class="botao" style="background:${CORES.tinta};border-radius:12px;">
                  <a href="${escapeHtml(urlSegura(produto.url))}" style="display:inline-block;padding:16px 28px;font-family:${FONTE};font-size:16px;font-weight:700;color:${CORES.papel};text-decoration:none;border-radius:12px;">Abrir na ${escapeHtml(loja)}</a>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <tr>
          <td style="padding:22px 10px 0;font-family:${FONTE};font-size:13px;line-height:1.6;color:${CORES.tintaSuave};">
            ${coleta ? `Preço coletado em ${coleta.dia} às ${coleta.hora}, horário de Brasília. ` : ''}Preços mudam rápido, então confira na loja antes de comprar.<br><br>
            Você recebe este e-mail porque está acompanhando este produto no Monitor de Preços.
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const texto = [
    titulo,
    nome,
    '',
    `Preço na ${loja}: ${formatBRL(precoAtual)}`,
    ...(economia
      ? [
          `Era ${formatBRL(precoOriginal)}. Você economiza ${formatBRL(economia.valor)} (${economia.pct}%).`,
        ]
      : []),
    '',
    'Por que avisamos você:',
    ...motivos.map((m) => {
      const { titulo: t, detalhe } = explicarMotivo(m, precoAtual);
      return `- ${t}. ${detalhe}`.trimEnd();
    }),
    '',
    `Abrir na ${loja}: ${produto.url}`,
    ...(coleta
      ? ['', `Preço coletado em ${coleta.dia} às ${coleta.hora}, horário de Brasília.`]
      : []),
  ].join('\n');

  return { assunto, html, texto };
}
