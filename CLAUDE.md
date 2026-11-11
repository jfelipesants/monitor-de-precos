# CLAUDE.md

Guia para agentes de IA (e humanos) trabalhando neste repositório.

## Visão geral

**Monitor de Preços** coleta periodicamente o preço de produtos em e-commerces (Kabum, Mercado Livre, Amazon), grava o histórico no Supabase (PostgreSQL) e envia alertas por e-mail quando:

- o preço atinge a meta do usuário (`meta_atingida`);
- o preço cai ≥ `ALERT_DROP_THRESHOLD` em relação à média de 30 dias (`queda_media`);
- o preço é o menor já registrado (`menor_preco_historico`).

Stack: Node.js ≥ 22.12 (ESModules), Axios + Cheerio, Playwright (opcional), Supabase JS, Zod 4, node-cron 4, Nodemailer, Pino, Vitest 5.

## Comandos

```bash
npm install                    # dependências
npm test                       # testes (Vitest)
npm run test:coverage          # testes + cobertura (mínimo: 80% linhas)
npm run lint                   # ESLint
npm run format                 # Prettier

npm run monitor:once           # executa UM ciclo e sai (usado no GitHub Actions)
npm start                      # daemon com node-cron (CRON_SCHEDULE)
npm run start:now              # daemon + ciclo imediato

npm run produto -- add --url <url> [--nome "..."] [--alvo 1500]
npm run produto -- list
npm run produto -- disable --id <uuid>
npm run produto -- test-scrape --url <url>   # coleta sem salvar (não precisa de .env)
npm run produto -- test-email                # testa SMTP
```

## Arquitetura

```
run-once.js / index.js / cli/      ← pontos de entrada (finos)
        │
   container.js                    ← composition root: monta tudo a partir do .env
        │
services/PriceMonitor.js           ← orquestra um ciclo (DI pelo construtor)
   ├── scrapers/ScraperFactory.js  ← domínio da URL → estratégia
   │      └── BaseScraper          ← Template Method: delay → fetch c/ retry → bloqueio → extração → Zod
   │            ├── KabumScraper, MercadoLivreScraper   (Axios + Cheerio)
   │            └── PlaywrightScraper → AmazonScraper   (navegador headless)
   ├── database/*Repository.js     ← Repository sobre o Supabase
   ├── services/PriceAnalyzer.js   ← regras de alerta (funções PURAS)
   └── notifications/NotificationService.js → channels/EmailChannel.js (Strategy)
```

### Fluxo de `PriceMonitor.processarProduto`

1. `scraperFactory.obterScraper(url).scrape(url)` → resultado validado pelo Zod.
2. `historicoRepo.obterEstatisticas()` **antes** de inserir (compara com o passado).
3. `historicoRepo.registrar()` + `produtoRepo.atualizarStatusColeta()`.
4. `analisarPreco()` → filtra por `estaEmCooldown()` → `notificationService.notificar()` → `alertaRepo.registrar()`.

A etapa 4 **nunca lança**: falha de alerta não invalida a coleta.

### Extração de preço em camadas (`BaseScraper.extrairDados`)

1. **JSON-LD** (`schema.org/Product`): mais estável. Ver `scrapers/extractors/jsonLd.js`.
2. **Meta tags** (Open Graph / microdata). Ver `extractors/metaTags.js`.
3. **Seletores CSS** (`static seletores` da loja, ou `extrairComSeletores()` sobrescrito).

Cada campo vem da primeira camada que o encontrou.

### Erros (`src/errors/index.js`)

Todos herdam de `AppError` (`retryable`, `context`, `cause`). `withRetry` só repete erros com `retryable: true`.

| Erro                       | Quando                              | Retry            |
| -------------------------- | ----------------------------------- | ---------------- |
| `BlockedError`             | HTTP 403/429, captcha               | sim              |
| `ScraperError`             | rede/timeout/5xx (sim), 404 (não)   | depende          |
| `ParseError`               | preço não encontrado no HTML        | não              |
| `ProdutoIndisponivelError` | esgotado, sem preço                 | não (log `warn`) |
| `ValidationError`          | dado reprovado pelo Zod             | não              |
| `DatabaseError`            | erro do Supabase/PostgREST          | —                |
| `NotificationError`        | falha SMTP                          | —                |
| `ConfigError`              | `.env` inválido, Playwright ausente | —                |

## Como adicionar uma nova loja

1. Crie `src/scrapers/stores/NovaLojaScraper.js`:
   ```js
   import { BaseScraper } from '../BaseScraper.js';
   export class NovaLojaScraper extends BaseScraper {
     static loja = 'nova_loja';
     static dominios = ['novaloja.com.br'];
     static seletores = { titulo: ['h1'], preco: ['.price'] };
   }
   ```
   Use `PlaywrightScraper` como base se o preço for renderizado via JavaScript.
2. Registre a classe em `ESTRATEGIAS_PADRAO` (`src/scrapers/ScraperFactory.js`).
3. Adicione `'nova_loja'` em `LOJAS` (`src/schemas/produto.schema.js`).
4. No banco: `alter type public.loja_tipo add value 'nova_loja';`
5. Salve um HTML reduzido em `tests/fixtures/` e escreva o teste em `tests/unit/scrapers/stores.test.js`.

O teste `ScraperFactory.test.js` garante que `LOJAS` e as estratégias registradas fiquem sincronizados.

## Como adicionar um canal de notificação

Crie uma classe com `nome` e `async enviar(alerta)` (que lança `NotificationError` em falha) em `src/notifications/channels/` e inclua-a no array `canais` em `src/container.js`. O `NotificationService` já envia em paralelo e isola falhas.

## Convenções

- ESModules, imports com extensão `.js`.
- Código e mensagens em **português**. Nomes de bibliotecas e padrões em inglês.
- Dependências externas sempre injetáveis (`httpClient`, `transporter`, `launchBrowser`, `sleepFn`, `random`, `relogio`) para testes determinísticos.
- Testes nunca acessam rede nem banco reais: use `tests/mocks/supabase.mock.js`, `criarHttpMock()` e as fixtures.
- Dinheiro no banco é `numeric(12,2)`. Em JS, `parsePrice()` arredonda para 2 casas.
- Mantenha o enum do banco, `LOJAS`/`ALERTA_TIPOS` e `static loja` em sincronia.

## Banco de dados

Scripts em `database/` (aplicar em ordem: `001_schema.sql`, `002_views.sql`, `003_rls.sql`). O backend usa a `service_role` key. RLS está ativo sem policies, então a `anon` key não acessa nada.
