# CIASystem

Sistema de gestão do RPG da CIA (Habblet/Forumeiros), substituindo o fluxo manual
(formulário → planilha do Google) por um sistema automatizado em Cloudflare
Workers + D1.

## Stack

- **Cloudflare Workers** — API (Hono + TypeScript)
- **Cloudflare D1** — banco de dados (SQLite gerenciado)
- **Wrangler** — CLI de desenvolvimento e deploy

## Setup local (primeira vez)

1. Instalar dependências:
   ```
   npm install
   ```
2. Autenticar a CLI da Cloudflare (abre o navegador uma vez):
   ```
   npx wrangler login
   ```
3. Copiar `.dev.vars.example` para `.dev.vars` e preencher com valores reais
   (esse arquivo nunca é commitado).
4. Preencher os `database_id` em `wrangler.toml` com os UUIDs reais dos bancos
   D1 (dev e produção) — pegue com `npx wrangler d1 list`.
5. Aplicar as migrations no banco de dev:
   ```
   npm run db:migrate:dev
   ```
6. Rodar localmente:
   ```
   npm run dev
   ```
   Acesse `http://localhost:8787/health` — deve responder `{"status":"ok",...}`.

## Estrutura de pastas

```
src/
├── index.ts        # entrypoint do Worker
├── routes/         # uma pasta/arquivo por domínio (requerimentos, grupos, fórum...)
├── services/       # regras de negócio (ex: cálculo de dias mínimos, checagem de hierarquia)
├── middlewares/     # auth (JWT), checagem de permissão
└── types/
migrations/          # migrations numeradas do D1, uma por fase de implementação
public/              # painéis HTML/Tailwind, se servidos pelo mesmo Worker
```

## Fases de implementação

O schema completo (`migrations/`) é dividido em fases, cada uma entregando algo
utilizável antes de passar pra próxima:

1. **Núcleo** (`0001_nucleo.sql`) — usuários, patentes, hierarquia, grupos.
2. **Requerimentos e histórico** — o motor central do RPG (promoção, rebaixamento,
   advertência, licença, contratação etc.), com aprovação e histórico.
3. **Fórum próprio, menu e páginas customizadas**.
4. **Reconhecimento** — cursos, certificados, medalhas, emblemas, honrarias, conquistas.
5. **Grupos avançados** — hub de cada grupo (registros internos, aulas, páginas).
6. **Documentos institucionais** — fluxo de revisão em 3 níveis.
7. **Comunicação** — e-mails, notícias, notificações.
8. **Mini Twitter** — tweets, curtidas, enquetes, seguidores.
9. **Sugestões e tickets de suporte**.

Cada fase nova de migration segue o padrão `000N_nome_da_fase.sql`, aplicada
primeiro em dev, testada, e só depois espelhada em produção.

## Workflow de deploy

Este projeto usa a **Git Integration nativa da Cloudflare** (configurada no
dashboard, em Workers → Settings → Builds):

- Push na branch `dev` → deploy automático no ambiente de dev.
- Push/merge na branch `main` → deploy automático em produção.

Migrations do D1 **não** rodam automaticamente nesse fluxo — depois de criar
uma migration nova, rode manualmente:

```
npm run db:migrate:dev     # sempre primeiro, testar em dev
npm run db:migrate:prod    # só depois de validar em dev
```

## Convenções

- Toda checagem de hierarquia/permissão acontece no Worker, nunca no cliente.
- Nunca commitar segredos — `.dev.vars` e valores reais de `database_id`
  sensíveis ficam fora do Git (ver `.gitignore`).
- Datas em TEXT ISO 8601. Booleans como INTEGER (0/1), padrão do SQLite.
