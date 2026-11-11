import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../src/config/env.js';
import { ConfigError } from '../../../src/errors/index.js';

const envValido = {
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
  SMTP_USER: 'eu@gmail.com',
  SMTP_PASS: 'senha app',
  EMAIL_TO: 'eu@gmail.com',
};

describe('loadConfig', () => {
  it('aplica valores padrão e converte tipos', () => {
    const config = loadConfig(envValido);
    expect(config.SMTP_PORT).toBe(465);
    expect(config.SMTP_SECURE).toBe(true);
    expect(config.ALERT_DROP_THRESHOLD).toBe(0.1);
    expect(config.SCRAPER_CONCURRENCY).toBe(2);
    expect(config.CRON_SCHEDULE).toBe('0 */6 * * *');
    expect(config.EMAIL_FROM).toBeUndefined();
  });

  it('converte strings do .env em números e booleanos', () => {
    const config = loadConfig({
      ...envValido,
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      ALERT_DROP_THRESHOLD: '0.15',
    });
    expect(config).toMatchObject({
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      ALERT_DROP_THRESHOLD: 0.15,
    });
  });

  it('trata variável vazia como ausente', () => {
    expect(loadConfig({ ...envValido, EMAIL_FROM: '  ' }).EMAIL_FROM).toBeUndefined();
  });

  it('devolve um objeto imutável', () => {
    expect(Object.isFrozen(loadConfig(envValido))).toBe(true);
  });

  it('lista todos os campos inválidos em um único ConfigError', () => {
    const fn = () => loadConfig({ SUPABASE_URL: 'não é url', EMAIL_TO: 'invalido' });
    expect(fn).toThrow(ConfigError);
    try {
      fn();
    } catch (err) {
      expect(err.message).toContain('SUPABASE_URL');
      expect(err.message).toContain('EMAIL_TO');
      expect(err.message).toContain('SMTP_PASS');
      expect(err.context.campos.length).toBeGreaterThanOrEqual(4);
      expect(err.message).toContain('SMTP_PASS: variável obrigatória não definida');
      expect(err.message).toContain('EMAIL_TO: EMAIL_TO deve ser um e-mail válido');
    }
  });

  it('rejeita delay máximo menor que o mínimo', () => {
    expect(() =>
      loadConfig({ ...envValido, SCRAPER_MIN_DELAY_MS: '5000', SCRAPER_MAX_DELAY_MS: '100' }),
    ).toThrow(/SCRAPER_MAX_DELAY_MS/);
  });
});
