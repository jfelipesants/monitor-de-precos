import { mensagemDeErro } from '../errors/index.js';

/**
 * Envia um alerta por todos os canais configurados, em paralelo.
 * A falha de um canal não impede os demais.
 */
export class NotificationService {
  /**
   * @param {{
   *   canais: Array<{ nome: string, enviar: (alerta: any) => Promise<unknown> }>,
   *   logger?: import('pino').Logger,
   * }} options
   */
  constructor({ canais = [], logger } = {}) {
    this.canais = canais;
    this.logger = logger;
  }

  /**
   * @param {any} alerta
   * @returns {Promise<{ enviados: string[], falhas: Array<{ canal: string, erro: string }> }>}
   */
  async notificar(alerta) {
    if (this.canais.length === 0) {
      this.logger?.warn('Nenhum canal de notificação configurado; alerta não enviado');
      return { enviados: [], falhas: [] };
    }

    const resultados = await Promise.allSettled(this.canais.map((canal) => canal.enviar(alerta)));

    const enviados = [];
    const falhas = [];
    resultados.forEach((r, i) => {
      const canal = this.canais[i].nome;
      if (r.status === 'fulfilled') {
        enviados.push(canal);
      } else {
        falhas.push({ canal, erro: mensagemDeErro(r.reason) });
        this.logger?.error({ canal, err: r.reason }, 'Falha ao enviar notificação');
      }
    });

    return { enviados, falhas };
  }
}
