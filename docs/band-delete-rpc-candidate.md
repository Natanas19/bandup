# Exclusao de banda: candidata local com retencao de 90 dias

Nao aplicada no Demo. Sem interface, worker ou Storage. Somente a candidata ainda
nao aplicada foi revisada; migrations historicas permanecem intactas. O preflight
remoto continua pendente e fora desta tarefa.

## Contrato e resposta perdida

RPC: `public.bandup_delete_band(p_band_id uuid, p_confirmation text, p_operation_id uuid)`.
O terceiro argumento e obrigatorio, sem default nem overload antigo de dois args.
A assinatura anterior nao foi aplicada ou integrada. Retorna somente status deleted,
operation_id e cleanup_status.

O cliente futuro deve gerar e persistir a tentativa ANTES da chamada, vinculada a
conta/banda/confirmacao. Deve reutilizar esse ID em consulta e retry; nao gerar um
novo para resolver resposta perdida. A seguranca nao depende de manter o UUID secreto.

Consulta: `public.bandup_get_band_deletion(p_operation_id uuid)`. Exige autenticacao
e filtra requested_by por auth.uid(). Recibo de outro ator, desconhecido ou ID NULL
e recibos expirados retornam NULL sem nomes ou dados da banda. Anon/service_role nao possuem EXECUTE;
UID ausente ou role incorreta sao recusados. NULL nao prova falha: a exclusao pode
estar em andamento, ainda sem commit visivel, ou o recibo pode ter expirado.
Consultar novamente em nova transacao; nunca interpretar NULL como prova de falha.

Apos commit e antes da expiracao, o autor pode consultar ou repetir exatamente a tentativa sem precisar
continuar integrante da banda. Replay exige mesma conta, banda e bytes de confirmacao;
divergencia recebe 42501 e nao altera nada. Lock advisory transacional por ID impede
concorrentes de redirecionarem a tentativa para outra conta/banda. Colisao de hash
apenas recusa temporariamente; nao muda o destino. A primeira execucao continua
exigindo administracao atual e nome exato.

A janela e de 2160 horas (90 x 24 horas), a partir do clock_timestamp capturado
apos o DELETE da banda dentro da RPC, antes do COMMIT. Nao depende de now() nem
do inicio de uma transacao longa. Na fronteira expires_at <= clock_timestamp(),
consulta retorna NULL e replay nao recupera resultado. Se o prazo vencer entre
a validacao do replay e a consulta final, o replay tambem pode retornar NULL.
Operacao consumida sem recibo valido recebe 42501 generico, antes de autorizar ou
bloquear qualquer banda. Nem o autor original pode reutilizar o ID em outra banda.
Nao existe recuperacao autenticada depois dos 90 dias. O cliente deve persistir a
tentativa antes da chamada, reconciliar dentro da janela e nao gerar novo ID para
resolver resposta perdida. A existencia dos IDs permanentes nao e exposta por RPC.

## Transacao e privilegios

A RPC exige sessao authenticated, auth.uid valido e READ COMMITTED; bloqueia tentativa,
valida recibo, verifica administracao, bloqueia banda/integrantes com NOWAIT, revalida
administracao e compara bytes UTF-8 sem trim/case folding/normalizacao. Insere IDs
permanentes; remove tarefas e depois banda; verifica uma linha removida; insere
recibo e job. Todos os passos confirmam na mesma transacao. Erro desfaz tudo,
incluindo os IDs permanentes. Falha tardia na insercao do job e coberta pelos testes.
SECURITY DEFINER, owner postgres, search_path vazio e referencias qualificadas.

EXECUTE apenas authenticated nas duas RPCs. DELETE direto e revogado; privilegio
herdado remanescente aborta instalacao integral. Outras RPCs/views destrutivas ainda
precisam ser inventariadas no preflight. As quatro tabelas privadas tem RLS, nenhuma
policy e nenhum grant para anon/authenticated/service_role. Somente postgres as acessa.
Postflight verifica tambem as ACLs efetivas das funcoes privadas e rejeita grants
inesperados, inclusive os originados por default privileges.

## Identidade permanente e corrida de recriacao

`private.band_deletion_tombstones` guarda somente band_id (PK), permanentemente.
`private.band_deletion_operations` guarda somente operation_id (PK), permanentemente.
Nao ha nomes, atores, confirmacoes, datas ou vinculo entre as duas tabelas permanentes.
Triggers recusam UPDATE, DELETE e TRUNCATE de ambas, inclusive DML comum do owner.
UUIDs continuam sendo identificadores correlacionaveis; isto minimiza dados, nao
promete anonimizacao. O crescimento permanente e de uma linha em cada tabela por
exclusao confirmada, com seus indices de PK; nao deve haver politica de remocao.

`private.band_deletion_receipts` guarda operacao, banda, ator, bytes da confirmacao,
created_at e expires_at durante a retencao. As FKs apontam aos IDs permanentes, nunca
a bands/Auth. Confirmacao UTF-8 e recuperavel, nao e hash nem criptografia; so esta
tabela temporaria guarda o nome e a identidade do autor. A CHECK fixa 2160 horas,
UPDATE/TRUNCATE sao proibidos e DELETE so aceita recibos vencidos. O indice
band_deletion_receipts_expiry_idx(expires_at,operation_id) suporta expurgos em lotes.

O trigger `bands_reject_deleted_identity`, AFTER INSERT OR UPDATE OF id, recusa UUID
excluido e torna a identidade de bandas existentes imutavel (reenviar mesmo ID e aceito).
AFTER e essencial: INSERT concorrente aguarda a chave primaria da banda em exclusao;
a consulta VOLATILE seguinte ve o registro confirmado em novo snapshot READ COMMITTED.
Um BEFORE isolado poderia consultar antes do commit e deixar a recriacao passar.

Criacao em REPEATABLE READ/SERIALIZABLE e recusada (25000), evitando snapshot antigo.
Essa restricao e a imutabilidade de ID precisam ser revisadas para consumidores no
preflight futuro. Nao se presume a configuracao remota.

A protecao independe da fila: remover um job nao libera o UUID. Restaurar a banda antiga
exige procedimento administrativo separado; nunca liberar UUID enquanto houver limpeza.

## Expiracao restrita e operacao futura

Entrada: `private.expire_band_deletion_receipts(p_batch_size integer DEFAULT 1000)`.
Retorna a quantidade removida; aceita somente 1..1000, sem cutoff, banda, ator ou ID
fornecido pelo chamador. SECURITY DEFINER, owner postgres, search_path vazio,
row_security off e lock_timeout 3s. Somente postgres pode executar; PUBLIC, anon,
authenticated e service_role nao tem EXECUTE. Nao e RPC publica nem concede acesso
direto as tabelas. Nao foi criado scheduler, worker ou papel privilegiado novo.

Em manutencao futura autorizada, com conexao confiavel como postgres, executar
`SELECT private.expire_band_deletion_receipts(1000);` em transacao curta e confirmar.
Repetir em lotes limitados; zero pode significar ausencia de vencidos OU linhas
bloqueadas. Outra rodada posterior deve tentar de novo. Nao dar credencial postgres
ao navegador ou worker de Storage. Uma futura role dedicada exige revisao separada.

O cutoff e capturado do relogio no inicio da funcao; nao pode ser antecipado pelo
chamador. FOR UPDATE SKIP LOCKED permite expurgos concorrentes. Replay valido usa
FOR SHARE no recibo, portanto o expurgo pula tentativas em andamento. Consulta
aplica o prazo pelo relogio mesmo dentro de transacao longa; MVCC pode permitir
uma resposta lida antes do vencimento, mas nunca autoriza nova exclusao com ID usado.
Recuperacao pode retornar NULL na fronteira; nenhum caminho recria recibo expirado.
Nao se desabilitam triggers ou RLS para expirar recibos. Rollback restaura o recibo.

A exclusao fisica depende da execucao dessa manutencao: sem scheduler os dados
vencidos ficam inacessiveis pelas RPCs, mas permanecem armazenados. Antes de operar
em producao, definir frequencia/SLA de expurgo. Monitorar contagem de vencidos,
menor expires_at vencido, linhas removidas, erros, duracao, locks/transacoes longas
e autovacuum. O SQL nao elimina copias historicas de backups/WAL ou logs; essas
retencoes exigem tratamento operacional proprio. Dados pessoais nunca devem ser
incluidos em mensagens de erro ou logs de manutencao.

## Fila e Parte 2

`private.band_logo_cleanup_jobs` fixa band-logos e gera prefixo <band_id>/; FKs separadas
apontam aos IDs permanentes, com RESTRICT, nunca ao recibo, bands ou Auth. Nao guarda
requested_by nem confirmacao. Banda sem
logo atual tambem gera job, pois pode haver uploads antigos. Retentativa nao recria
job removido. Recibo sem job retorna cleanup_status not_available, sem presumir limpeza.

O worker futuro requer acesso minimo, reserva/fencing, retries, paginacao, verificacao
de uploads tardios e remocao exclusiva pela Storage API. Nenhum arquivo e apagado nesta
parte; nao ha destino avatars. URLs publicas e caches podem persistir ate/depois da limpeza.
Jobs pendentes sobrevivem indefinidamente ao expurgo do recibo; nao expira-los por idade.
O trigger band_logo_cleanup_jobs_identity_immutable proibe UPDATE de band_id ou
operation_id, inclusive reenvio desses campos sem mudanca. Processadores futuros
devem atualizar somente estado/lease/retry, nunca reenviar campos de identidade.
Enquanto existe, a fila conserva a correlacao operacao/banda necessaria ao processamento.
Retencao de jobs concluidos e monitoramento de backlog/needs_attention pertencem a Parte 2.

## Alternativas e decisao

- Somente a fila nao protege UUID apos retencao; escolhidos dois registros permanentes minimos.
- Sem registro permanente de operacoes, expirar recibos permitiria redirecionar IDs antigos.
- Nome e ator ficam no recibo temporario, preservando replay exato sem chave HMAC adicional.
- ID gerado no servidor nao resolve perda da propria resposta; escolhido ID preexistente.
- Consulta por banda ou SELECT direto amplia enumeracao; escolhida tentativa filtrada pelo ator.
- Suportar snapshots antigos exigiria outro protocolo; escolhido AFTER + READ COMMITTED,
  com teste real da espera na chave primaria. UUID aleatorio sozinho nao e a protecao.

## Limites e aplicacao futura

Preflight separado deve confirmar projeto, catalogo/FKs/indices/deferrabilidade, triggers,
auxiliares, ACLs/heranca/default privileges, views e outros caminhos destrutivos. Os gates
nao comprovam paridade remota. Coordenar assinatura e restricoes com consumidores.
Backup logico nao contem binarios nem comprova restauracao testada. Nao usar db push ou
repair para contornar ledger divergente. Aplicacao integral so apos autorizacao separada;
erro exige rollback, sem exclusao real para testar instalacao ou recuperacao automatica.

## Validacao

Historico anterior a retencao: 53 verificacoes de cascata e 83 do grupo RPC aprovadas (grupo RPC inclui fixtures
compartilhadas). Incluem autorizacao, replay, recibos de terceiros, troca de destino/ator,
rollback do recibo/job, protecao apos remocao de job e imutabilidade. Duas sessoes validam
commit unico e recuperacao sem usar a resposta original. INSERT comeca antes do commit,
aguarda a chave primaria e depois e recusado. Criacao com snapshots antigos e recusada.

Manifesto: `C:/Users/USURIO~2/AppData/Local/Temp/bandup-delete-core-hrCSPO/result.json`.
Cluster encerrado; fontes SQL inalteradas. Sem acesso ao Demo. Base/RLS/trigger do ultimo
admin sao locais; ponte e CHECK sao as definicoes fornecidas. Auth sintetico, sem JWT/HTTP.

A suite atual acrescenta expurgo limitado/repetido, negativa antes do vencimento,
negativa de API roles, rollback tardio, dados permanentes minimos, job sem ator/FK
para recibo, replay/UUID apos expurgo e preservacao de outra banda. O runner exercita
replay atravessando expires_at em transacao longa, SKIP LOCKED, dois expurgadores,
consulta e tentativa de redirecionamento durante expurgo, alem da exclusao concorrente.
Fixtures historicas e de fronteira sao inseridas pelo owner no cluster sintetico;
nao se altera relogio nem se desabilitam protecoes.

Resultado atual em 12/11/2026: 53 checks de cascatas e 122 do grupo RPC aprovados,
mais concorrencia real. Manifesto:
`C:/Users/USURIO~2/AppData/Local/Temp/bandup-delete-core-O4Gxtw/result.json`.
suitePassed, stopped e sourcesUnchanged = true. TypeScript, lint completo e lint/sintaxe
do runner aprovados. Ver README para detalhes e limites da evidencia local.
