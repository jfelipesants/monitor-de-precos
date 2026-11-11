import nodemailer from 'nodemailer';
import { NotificationError } from '../../errors/index.js';
import { renderizarAlertaEmail } from '../templates/alertaTemplate.js';

/**
 * Canal de notificação por e-mail (SMTP via Nodemailer).
 *
 * Todo canal segue o mesmo contrato (Strategy):
 *   - `nome`: identificador gravado na tabela `alertas.canais`;
 *   - `enviar(alerta)`: envia e lança NotificationError em caso de falha.
 * Para adicionar Telegram/WhatsApp no futuro, basta criar uma classe com essa interface.
 */
export class EmailChannel {
  nome = 'email';

  /**
   * @param {{ transporter: { sendMail: Function, verify?: Function }, from: string, to: string }} options
   */
  constructor({ transporter, from, to }) {
    this.transporter = transporter;
    this.from = from;
    this.to = to;
  }

  /** Cria o canal a partir da configuração validada do .env. */
  static fromConfig(config) {
    const transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
    });
    return new EmailChannel({
      transporter,
      from: config.EMAIL_FROM ?? `"Monitor de Preços" <${config.SMTP_USER}>`,
      to: config.EMAIL_TO,
    });
  }

  /** @param {Parameters<typeof renderizarAlertaEmail>[0]} alerta */
  async enviar(alerta) {
    const { assunto, html, texto } = renderizarAlertaEmail(alerta);
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: this.to,
        subject: assunto,
        html,
        text: texto,
      });
      return { id: info?.messageId ?? null };
    } catch (err) {
      throw new NotificationError(`Falha ao enviar e-mail: ${err?.message ?? err}`, {
        cause: err,
        context: { canal: this.nome, codigo: err?.code, resposta: err?.response },
      });
    }
  }

  /** Testa conexão e autenticação SMTP sem enviar nada. */
  async verificar() {
    try {
      await this.transporter.verify?.();
    } catch (err) {
      throw new NotificationError(
        `Não foi possível autenticar no servidor SMTP: ${err?.message ?? err}. ` +
          'Se usa Gmail, confirme que SMTP_PASS é uma "senha de app".',
        { cause: err, context: { canal: this.nome } },
      );
    }
  }
}
