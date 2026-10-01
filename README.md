# BandUp

Esqueleto inicial do BandUp, criado com Next.js, React, TypeScript e Tailwind CSS.

## Executar localmente

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000) no navegador.

## Estrutura inicial

- `src/app/`: rotas e layout usando o App Router do Next.js.
- `public/`: arquivos estáticos servidos diretamente pelo Next.js.

## Verificações

```bash
npm run lint
npm run build
```

## Supabase

1. Copie `.env.example` para `.env.local` e preencha a URL do projeto e a chave publishable no painel do Supabase.
2. Aplique `supabase/migrations/20261001000000_initial_bandup_schema.sql` no SQL Editor do projeto.
3. Use `getSupabaseBrowserClient` de `src/lib/supabase/client.ts` em componentes cliente.

A chave publishable fica visivel no navegador. O acesso as tabelas depende das politicas RLS da migracao; nunca coloque uma chave `service_role` em variaveis `NEXT_PUBLIC_*`.
