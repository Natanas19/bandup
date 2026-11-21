# Teste isolado de hardening de band_members

Executor manual: band-members-hardening-isolated.cjs; fixture sintetica:
band-members-hardening-fixture.sql. Usa Node.js e PostgreSQL 17 existentes em
C:/Program Files/PostgreSQL/17/bin. Nao importa nem executa a suite de logos.

```powershell
$env:BANDUP_MEMBERS_LOCAL_TESTS = 'create-isolated-cluster'
node tests/postgres/band-members-hardening-isolated.cjs --execute
```

Cria cluster exclusivo em diretorio temporario aleatorio na raiz ASCII do
workspace, com marcador de propriedade, porta dinamica exceto 5432/5433 e
loopback exclusivo. Cada conexao verifica banco, porta, endereco, versao,
data_directory fisico e usuarios antes de enviar SQL de preparacao/teste.
Nao aceita URL externa, nao le .env, nao conecta ao Supabase/servidor existente.
PG* herdadas sao removidas; trust e durabilidade desabilitada sao exclusivos
da instancia descartavel. Nao executar em maquina multiusuario nao confiavel.
No Windows, pg_ctl pode exigir execucao aprovada fora do sandbox.

A candidata revisada e executada integralmente sem substituir manifesto,
pois hashes amplos deixaram de ser requisitos. Somente o cenario de falha
injetada usa copia em memoria para levantar erro apos REVOKE. SHA-256 garante
que o arquivo candidato nao mudou durante a rodada.

Cenarios:
- Definer critico divergente aborta sem mudar ACL/dados.
- Candidata integral funciona sem bandup_delete_band instalada.
- Grant UPDATE por coluna inesperado aborta sem altera-lo. A assercao distingue
  ACL explicita via aclexplode de privilegio efetivo herdado da tabela;
  attacl NULL nao implica ausencia de UPDATE efetivo.
- Erro injetado depois do REVOKE restaura ACL/dados em nova conexao.
- INSERT/UPDATE/UPSERT negados para admin/membro, SELECT autorizado preservado.
- DELETE nao autorizado nao atinge linhas; remocao de membro comum funciona.
- Criacao, aprovacao e saida por definers simulados funcionam, com sucessao
  administrativa e rollback da saida sem sucessor.

PASS aparece somente apos assercoes. Erro interrompe e nao aprova cenarios
posteriores. A linha de identidade BANDUP_GATE validada e separada dos resultados
SQL. Finalmente encerra somente o cluster proprio; remove apenas o diretorio
cujo caminho, parent, prefixo, marcador, ausencia de postmaster.pid e ausencia
de symlinks foram validados. Falha de parada/identidade conserva os arquivos.
Interrupcao forcada pode exigir recuperacao manual do diretorio identificado,
nunca parada do servico compartilhado ou limpeza generica por prefixo.

Historico: conflito PL/pgSQL r/alias r e contaminacao de resultados por BANDUP_GATE
foram corrigidos anteriormente; 15/15 cenarios passaram na versao com manifesto.
A revisao proporcional substitui o antigo teste de manifesto vazio pelo teste
de divergencia do definer e remove dependencias amplas. Resultados desta versao
devem ser reportados na rodada especifica. Auth e funcoes sao simulados; sucesso
local nao certifica o Demo nem autoriza aplicar SQL remoto.