# Candidato estavel para apresentacao

Branch: `release/demo-senai-estavel-2026-11-05`.
Base exata: `b455463` (integracao dos quatro grupos).
Worktree: `D:/Projetos/bandup-stable-release`.
As alteracoes do candidato permanecem sem commit. A branch original, os arquivos locais e os stashes foram preservados.

## Escopo incorporado

- Tarefas pessoais: somente `assigned_to = auth.getUser().id`, com filtro das bandas autorizadas, nomes das bandas, paginacao, ordenacao e erros distintos de lista vazia.
- Nome do usuario no cartao lateral, com fallback Meu Perfil e invalidacao na troca de conta.
- Nomes dos integrantes pelo contrato aplicado `bandup_member_display_names(p_band_id)`, associados por UUID e com fallback Integrante. Nenhum acesso direto a auth.users pelo frontend.
- Formulario de tarefas com select de um unico responsavel. As gravacoes continuam usando tasks.assigned_to.
- Cadastro, login, bandas, Agenda, navegacao, controles de sessao e publicacao mantidos do commit-base. Sem novas correcoes nesses fluxos.
- Fallback especifico para ausencia de tasks.event_id mantido.

## Arquivos incorporados ou adaptados

Aplicacao:
- src/app/bandas/[bandId]/tarefas/page.tsx
- src/app/meu-perfil/[section]/page.tsx
- src/components/personal-workspace.tsx
- src/components/personal-account-name.tsx
- src/components/personal-tasks.tsx
- src/lib/display-name.ts
- src/lib/personal-tasks.ts

Testes:
- tests/display-name.test.cjs
- tests/personal-profile.test.cjs
- tests/personal-account-name.test.cjs
- tests/personal-tasks.test.cjs
- tests/task-member-names.test.cjs
- tests/member-display-names-migration.test.cjs
- tests/stable-release-boundary.test.cjs

Contrato ja aplicado, incluido somente para versionamento e revisao estatica:
- supabase/migrations/20261105120000_band_member_display_names.sql

Documento: docs/stable-release-candidate.md.

Nao foram incorporados: task_assignees_expand, task_assignees_activate, servico ou checkboxes experimentais, testes exclusivos da ativacao, artefatos de laboratorio, imagem de demonstracao e alteracoes de package-lock.json.

## Contrato do Demo e limites da validacao

Segundo a confirmacao do responsavel pelo Demo, nomes e expansao foram aplicados, mas ativacao falhou. O candidato nao consulta task_assignees, a RPC de prontidao, bandup_save_task ou task_revision. Nao depende da ativacao e nao tenta aplica-la.

A compatibilidade de escrita pressupoe que a ponte da expansao continua instalada e que a falha da ativacao nao deixou guardas ou outros objetos parciais. Testes locais com mocks e testes SQL estaticos nao comprovam esse estado, RLS ou isolamento real. Se o Demo recusar a escrita, registrar o erro e interromper a publicacao; nao mascarar erro nem alterar o banco.

Nao executar supabase db push nem reaplicar migrations historicas. O arquivo de nomes ja aplicado nao representa uma nova instrucao de aplicacao. Nenhuma migration e necessaria para este candidato.

## Validacao local

Dependencias reutilizadas por junction node_modules para o diretorio da integracao; nenhum pacote foi instalado e nenhum lockfile foi modificado. Nenhum arquivo de ambiente foi copiado e nenhuma variavel foi alterada.

Comandos no worktree candidato:
- node --require ./tests/deny-network.cjs --test tests/*.test.cjs
- npm run lint
- node --require ./tests/deny-network.cjs node_modules/next/dist/bin/next build
- node node_modules/typescript/bin/tsc --noEmit --incremental false
- git diff --check

Build sem configuracao do Demo: comprova compilacao e geracao das rotas, nao a conexao ou configuracao de Production. O preload deny-network e exclusivo dos testes e nao deve ser configurado na Vercel.

## Proxima validacao autorizada

1. Revisar o diff e a ausencia de artefatos experimentais. Confirmar o erro da ativacao e a integridade do modo escalar por evidencia somente de leitura.
2. Em Preview apontado ao Demo, validar as tres contas: login/logout/troca de conta, nomes e fallback, bandas permitidas, tarefas pessoais somente do responsavel, tarefa sem responsavel, criacao/edicao/remocao/reassociacao unica e Agenda sem tasks.event_id.
3. Validar cadastro e confirmacao de email, inclusive URL de retorno; nao presumir que testes das contas existentes validam novos cadastros.
4. Conferir desktop/mobile e navegacao Dashboard, perfil e workspace. Descoberta/solicitacoes continuam indisponiveis em Production; Agenda pessoal permanece Em breve. Publicacao publica e escrita de links continuam pausadas.
5. Somente apos aprovacao, preparar commit/PR e plano de Production. Nenhum commit, merge, push ou deploy foi executado nesta preparacao.
