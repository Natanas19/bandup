# Interface da apresentação — publicação pública pausada

A interface foi transportada dos arquivos commitados em `c91b835` da feature.
Nenhuma migration, fixture, launcher ou evidência de laboratório foi transportada.

`NEXT_PUBLIC_BANDUP_PUBLICATION_ENABLED` fica ausente ou `false`. O controle é
compilado no build e compartilhado entre servidor e cliente; mudar o ambiente exige
outro build. Não habilitar sem revisão explícita do schema, grants e RLS.

Nesse modo, a página pública e os metadados não carregam dados, o leitor de servidor
e as ações públicas recusam acesso antes de criar clientes, e as configurações
mostram indisponibilidade. Visão geral usa id/nome/descrição; links usam somente
campos legados, após autenticação e membership. Adicionar, editar, excluir e
publicar links ficam bloqueados. Essa pausa não altera a visibilidade de links
já existentes nem protege caminhos públicos antigos do banco.

As proteções do aplicativo não substituem RLS, não restringem clientes externos
à API e não comprovam compatibilidade de produção. Login, tarefas e eventos
continuam dependentes do Auth e das permissões existentes. Validar em Preview
com destino aprovado antes de promover à main; não aplicar migrations para isso.

Validação local: lint, testes com clientes mockados e build sem rede externa,
com publicação desativada e configuração sintética. `tests/deny-network.cjs` é
um preload apenas de validação; não é importado pelo aplicativo. O smoke test
`node tests/release-smoke.cjs` inicia e encerra somente um servidor Next local em
127.0.0.1:3105, valida a rota pública compilada e bloqueia conexões externas.
Não inicia nem acessa PostgreSQL. Não configurar esse preload na Vercel.
