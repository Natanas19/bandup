# BandUp

Aplicação de gestão de bandas com Next.js, React, TypeScript, Tailwind CSS e Supabase.

## Node.js e instalação

Use Node.js **22**, referência **22.18.0** em `.nvmrc`. O mínimo declarado em `package.json` e no lockfile é 22.0.0.

```bash
nvm install 22.18.0
nvm use 22.18.0
node --version
npm ci
```

No nvm para macOS/Linux, `nvm install` e `nvm use` também leem `.nvmrc`; no nvm-windows, informe a versão explicitamente. `npm ci` respeita o lockfile.

## Variáveis de ambiente

Copie `.env.example` para `.env.local` e preencha localmente:

| Variável | Uso |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL HTTPS do projeto Supabase. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave publishable do mesmo projeto; o leitor público também aceita JWT legado com papel anon. |
| `SUPABASE_INTERNAL_URL` | Opcional, somente servidor; sem ela, usa a URL pública. Deve ser HTTPS fora do desenvolvimento. Não copie endpoints de laboratório para produção. |

As variáveis `NEXT_PUBLIC_*` são incorporadas ao navegador durante o build. Nunca use chaves secretas ou `service_role` nelas. O acesso depende das políticas RLS instaladas. Não versione `.env.local` ou credenciais.

As origens exatas do laboratório estão centralizadas em `src/lib/development-lab.ts`, preservando a configuração existente. As exceções HTTP só valem com `NODE_ENV=development`; o Next usa a lista de origens para seu servidor de desenvolvimento. Não é uma configuração de produção.

## Executar localmente

```bash
npm run dev
```

Abra http://localhost:3000. `src/app/` contém as rotas e o layout App Router; `public/` contém arquivos estáticos. Use `getSupabaseBrowserClient` de `src/lib/supabase/client.ts` em componentes cliente.

## Banco: ordem das dez migrations

Roteiro para uma futura instalação autorizada, não uma instrução para reaplicar migrations existentes. Confira o histórico do destino, compatibilidade, dados legados e recuperação antes de executar. Os arquivos devem permanecer inalterados e seguir esta ordem:

1. `20261001000000_initial_bandup_schema.sql`
2. `20261002160000_tasks_delete_admins_only.sql`
3. `20261002170000_events_delete_admins_only.sql`
4. `20261002190800_events_custom_event_type.sql`
5. `20261002200000_tasks_optional_event_link.sql`
6. `20261017180000_record_ownership_guards.sql`
7. `20261020000000_public_band_profiles.sql`
8. `20261023000000_tasks_ownership_immutable.sql`
9. `20261027000000_external_link_url_safety.sql`
10. `20261027010000_functional_integrity.sql`

Os arquivos estão em `supabase/migrations/`. Não aplique somente a primeira migration. O usuário informou posteriormente a validação das migrations 9/10 em laboratórios isolados; os relatórios locais ainda descrevem revisões preparadas, sem um registro final que reconcilie essa informação. Isso não comprova aplicação ou compatibilidade em produção. Consulte [o plano de diagnóstico somente leitura](docs/supabase-production-readonly.md) para evidências, pré-requisitos e condições de autorização. As condições históricas dos ensaios SQL estão em `supabase/tests/sql_test_execution.md`, `external_link_url_safety.md` e `functional_integrity.md`; não execute esses testes ou fixtures em produção.

## Verificações locais

```bash
node --test tests/*.test.cjs
npm run lint
npx --no-install tsc --noEmit --incremental false
git diff --check
npm run build
```

Os testes JavaScript usam mocks e não substituem integração com Auth, PostgREST ou RLS. Para um build isolado, use uma cópia temporária dos candidatos ao Git, dependências já instaladas e variáveis sintéticas, sem copiar `.env.local`. Não use credenciais reais nessa verificação.

Os scripts Python locais de manutenção e `public/demo/magijos.svg` sem uso são ignorados individualmente. Os arquivos aprovados foram registrados nos cinco commits locais descritos no histórico; a auditoria preserva a proposta anterior como registro histórico. A preparação atual do diagnóstico não autoriza conexão, SQL, commit, push ou deploy. Consulte `docs/auditoria-final.md` e `docs/supabase-production-readonly.md` para os limites de cada etapa.


Para o esquema com camada pública legada, a sequência original acima não é aplicável
automaticamente. Consulte o [ramo de compatibilidade](docs/publication-compatibility.md)
e seu [manifesto](supabase/compatibility-publication.manifest.json): M8 é pré-requisito,
M7/M9 originais ficam excluídas e `supabase db push` permanece bloqueado. Os artefatos
desse ramo estão preparados para revisão e ensaio futuro, sem execução SQL nesta etapa.
