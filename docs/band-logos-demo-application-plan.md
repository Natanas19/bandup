# BandUp — plano de aplicação controlada de band-logos

Preparado em 11/11/2026. **NÃO EXECUTADO. Execução bloqueada até comprovar backup e receber autorização específica.**

## Artefato e escopo exatos

- Projeto único: Supabase Demo `zwmihhdvvpqgyavworgh`, compartilhado com a aplicação publicada.
- Arquivo único: `supabase/migrations/20261112100000_band_logos.sql`.
- SHA-256: `e82886f5f2ab636203519524b360692ba9d0d04d043e87eeda900ca631d53214`.
- O arquivo original não foi alterado nem duplicado em um script de execução.
- O relatório `tests/postgres/README-band-logo-isolated.md` e o manifesto da rodada isolada registram 43/43 cenários aprovados no PostgreSQL 17.11, com esse hash. Auth e Storage foram simulados; o banco local foi preservado e a instância parada.
- Sete verificações remotas sem conflitos foram informadas pelo usuário. Seus resultados precisam ser reconfirmados na janela imediatamente anterior; não foram reexecutados nesta preparação.
- Não inclui deploy, criação de contas/bandas/arquivos de teste, limpeza, alteração de configurações Auth, db push, migration repair ou operações no ledger.

## Backup: evidência disponível e bloqueio

Nesta preparação foram inventariados nomes/metadata, inclusive arquivos ignorados do repositório (excluídos node_modules, .git, .next e .env), diretórios relevantes em D:/Projetos e arquivos de diagnóstico. Não foi encontrado dump/snapshot de banco verificável nesses locais.
`D:/Projetos/bandup-backup-2026-11-04.git` contém estrutura de repositório Git (HEAD/objects/refs); não comprova backup do Demo nem estado atual de dados/Auth/Storage.
Não foi obtida confirmação de backup no painel Supabase. Isso significa **backup não comprovado**, não que backups remotos não existam. Não houve leitura de conteúdo de dumps, credenciais ou dados de usuários.

Antes de autorizar execução, preencher apenas metadata sem segredos:

| Evidência | Estado |
|---|---|
| Projeto do backup: zwmihhdvvpqgyavworgh | Pendente |
| Tipo, identificador/local seguro e status concluído | Pendente |
| Data/hora com fuso e ponto recuperável | Pendente |
| Cobertura: schema, dados, Auth e metadados Storage; exclusões documentadas | Pendente |
| Integridade/legibilidade e evidência de restauração em destino separado | Pendente |
| Diferença entre ponto do backup e estado atual/RPO aceito pelo responsável | Pendente |
| Cobertura independente dos arquivos binários existentes no Storage | Pendente |
| Responsável, acesso operacional e procedimento de recuperação | Pendente |

Preferir ponto de recuperação imediatamente anterior à janela. Não aceitar só data do arquivo, um dump antigo ou a existência de backup diário/PITR como prova de cobertura atual. Se houve alterações depois do ponto, registrar o intervalo e a estratégia para preservar essas escritas; não assumir perda zero.
Backups do banco não incluem os arquivos binários do Storage. Confirmar proteção desses objetos separadamente. Não criar/copiar/remover objetos como parte desta preparação. [Supabase: Database Backups](https://supabase.com/docs/guides/platform/backups).
Se não houver evidência válida, parar e solicitar uma etapa específica de backup/verificação, sem executar a migration.

## Imediatamente antes da execução — somente leitura

1. Confirmar projeto no painel e conexão selecionada, executor autorizado, PostgreSQL compatível, horário/fuso, janela e responsáveis. Não registrar string de conexão, senha, token ou headers.
2. Recalcular o hash local e comparar com o hash acima e o registro isolado. Se diferente, parar.
3. Reconfirmar as sete verificações e salvar inventário prévio privado: estrutura/RLS de bands, band_members e storage.objects; estrutura de buckets/objects; função private.is_band_admin(uuid); triggers/rotinas de criação e administração; policies atuais e permissões herdadas/default privileges/papéis customizados. SQL Editor administrativo não comprova o comportamento das sessões HTTP autenticadas.
4. Avaliar em SELECT as mesmas condições do preflight: nenhum dos três papéis anon/authenticated/service_role tem CREATE em private, associação a postgres, SET em session_replication_role ou TRIGGER/TRUNCATE em bands; anon/authenticated não são superuser/BYPASSRLS. Confirmar permissões de postgres para criação/ownership de funções, tabela e policies de Storage. Se incompatível, parar; não ajustar grants para forçar instalação.
5. Reconfirmar ausência dos objetos abaixo. Qualquer presença inesperada exige revisão de estado parcial, mesmo que a migration aceite bucket preexistente de configuração idêntica.
6. Registrar definições atuais das policies de avatars e configuração de seu bucket para comparação posterior. Não exportar fotos nem dados pessoais para este relatório.
7. Confirmar que fluxos da release publicada não alteram logo_url diretamente. A busca no código local identificou somente a nova RPC como escritora, criação omitindo a coluna e update de is_public preservando-a; isso não prova equivalência da release publicada.
8. Consultar atividade/locks, evitando janela com DDL, testes de administração ou transações longas concorrentes. Coletar apenas PID/estado/duração/wait events, não textos de queries que possam conter dados ou segredos. Combinar uma janela curta sem mudanças concorrentes de schema.
9. Confirmar backup e recuperação acima, registro de aprovação e que nenhuma ferramenta fará aplicação automática paralela. O ledger divergente não será tocado.

### Identidades novas previstas

- Bucket público `band-logos`: 2097152 bytes, MIME image/jpeg, image/png, image/webp.
- Tabela `private.band_logo_write_permits`.
- Funções: `private.band_logo_band_id(text)`, `private.authorize_band_logo_insert(text)`, `private.can_read_band_logo(text)`, `private.guard_band_logo_write()`, `public.bandup_set_band_logo(uuid,text)`.
- Trigger `bands_guard_logo_write` em public.bands.
- Oito policies em storage.objects: `band_logos_insert_admin`, `band_logos_select_admin`, `band_logos_insert_gate`, `band_logos_select_gate`, `band_logos_insert_authorization`, `band_logos_select_authorization`, `band_logos_no_update`, `band_logos_no_delete`.

## Aplicação — somente após autorização específica

1. Abrir o SQL Editor no projeto confirmado. Selecionar o papel administrativo validado. Conferir que não há transação anterior pendente.
2. Carregar **o arquivo inteiro**, do BEGIN inicial ao COMMIT final, sem selecionar fragmentos, remover verificações, criar um BEGIN adicional ou editar o SQL no painel.
3. O arquivo já usa transação única: lock_timeout local 3s e statement_timeout local 30s; helper/RPC também limitam espera de locks a 3s. O statement_timeout não é um prazo total da migration: vale por instrução. Os locks podem causar espera/erros transitórios na aplicação compartilhada.
4. Executar uma única vez e registrar horário/resultado sanitizado. Em erro, interromper: não prosseguir após instrução que falhou e não reaplicar pedaços. Garantir ROLLBACK/encerramento da transação abortada na mesma sessão.
5. Se houver perda de conexão/resposta, não presumir sucesso nem repetir. Verificar primeiro, apenas em leitura, presença e definições dos objetos e se o commit ocorreu. Uma migration transacional não deveria deixar seu próprio conjunto parcialmente aplicado; qualquer estado inesperado exige investigação delimitada.

## Validação pós-aplicação

**Primeira fase: só leitura, sem novas contas/bandas/objetos.**

- Confirmar bucket/configuração, cinco funções e respectivos owners/proconfig/ACLs, trigger habilitado AFTER INSERT/UPDATE e oito policies/cmd/roles/qual/with_check.
- Conferir privilégios efetivos mínimos: apenas authenticated executa os dois wrappers necessários e a RPC; parser/trigger sem EXECUTE da API; tabela privada inacessível aos três papéis e com contagem zero. Confirmar search_path pg_catalog,pg_temp e row_security=off dos definers, RLS da tabela privada e owners.
- Comparar inventário anterior: policies/bucket avatars, triggers de administração e grants existentes preservados. A migration não deve alterar logo_url de bandas já existentes.
- Conferir ausência de erros novos na aplicação publicada, com logs sanitizados. Não declarar uploads aprovados por existir bucket ou policy.

**Segunda fase: testes funcionais com escrita, autorização separada.**

Usar somente contas/bandas e caminhos UUID descartáveis registrados. Validar criação sem foto, associação com foto, retry sem duplicação, permissões cruzadas/anon/membro, UPDATE/DELETE negados, limites/MIME no serviço, SELECT/list/info, entrega pública, revogação concorrente e regressão de avatars. Comparar existência/conteúdo antes/depois das tentativas proibidas.
Auth/JWTs, Storage HTTP, probes/savepoints, gravações internas, bytes/CDN/CORS não foram comprovados pelos 43 testes PostgreSQL.
Nenhuma limpeza automática; objetos/contas/bandas de teste exigem autorização posterior específica.

## Recuperação sem perda de dados

### Erro antes do commit

A transação deve reverter bucket/DDL/grants criados por esta execução. Se a sessão permanecer abortada, emitir ROLLBACK nela somente sob a autorização da execução. Comparar os catálogos com o inventário prévio antes de tentar novamente. Nenhuma restauração ampla é necessária por um rollback transacional confirmado.

### Resposta ambígua

Parar novas tentativas e consultar o estado. Não executar COMMIT/ROLLBACK em outra sessão esperando reverter uma transação já encerrada. Não tentar reparar ledger nem aplicar novamente para descobrir se houve sucesso.

### Falha depois de commit confirmado

1. Suspender novas tentativas de foto; não publicar a interface local nem iniciar a fase de testes de escrita. Preservar bandas, associações, tarefas, valores de logo_url, bucket avatars, bucket band-logos e todos os arquivos/metadados existentes.
2. Registrar erro/SQLSTATE e estado pós-falha sanitizados. Preferir correção localizada revisada, mantendo as proteções de RLS/trigger. Não desativar a guarda de logo_url isoladamente e não conceder acesso amplo.
3. Se for preciso conter imediatamente chamadas de associação, preparar autorização específica para revogar apenas EXECUTE da nova RPC de authenticated e verificar acesso efetivo herdado, em transação curta. Essa contenção não elimina objetos nem resolve sozinha uma incompatibilidade de trigger; a RPC só poderá ser reabilitada após validação. Nenhum REVOKE foi executado nesta preparação.
4. Caso seja indispensável desfazer schema, preparar outro SQL revisado com base no inventário anterior e no estado pós-commit. Lista de candidatos limita-se às identidades novas acima; não usar CASCADE, não remover bucket/arquivos, não apagar/limpar logo_url e não tocar em avatars ou triggers de administração. Antes de remover policies de band-logos, preparar proteção substituta que mantenha o bucket retido fechado para escrita e não dependa das funções a remover. Não simplesmente retirar todas as policies, pois outra permissiva ALL poderia ampliar acesso.
5. A tabela de permissões só pode ser candidata à remoção se estiver vazia e sem dependências inesperadas. Qualquer arquivo/foto já associado deve permanecer acessível conforme a configuração pública anterior, sem mudança de URL. Toda compensação exige simulação/revisão e nova autorização; este plano não contém um script automático de DROP.
6. Restauração de backup é último recurso: restaurar primeiro em destino separado, conferir cobertura e diferenças, preservar escritas posteriores e só então decidir a recuperação do Demo com autorização específica. Não restaurar um backup antigo por cima do Demo como rollback padrão. Arquivos do Storage não são recuperados apenas por restaurar banco. [Supabase: restauração/PITR](https://supabase.com/docs/guides/platform/backups).

## Checklist curto para aprovação humana

- [ ] Backup do projeto comprovado, recente/compatível com o RPO aceito, cobertura de Storage separada e recuperação revisada.
- [ ] Hash e evidência 43/43 conferidos; sete verificações atualizadas e inventário prévio salvo com segurança.
- [ ] Projeto/executor/janela confirmados; nenhuma colisão/ACL incompatível ou operação concorrente de schema.
- [ ] Aprovada somente a execução integral do arquivo fixado, uma vez, com sua transação e timeouts.
- [ ] Pós-checks somente leitura e critérios de parada combinados; autorização de escrita para smoke tests é separada.
- [ ] Sem db push, migration repair, ledger, commit, push, deploy ou exclusões.

**Pedido de autorização específico (ainda não concedido):** aplicar integralmente esse arquivo, com esse hash, apenas no Demo zwmihhdvvpqgyavworgh, após comprovar backup e reconfirmar as pré-condições. A autorização não inclui criação/limpeza de dados de teste, recuperação pós-commit ou deploy. Se qualquer gate falhar, parar sem aplicar.
