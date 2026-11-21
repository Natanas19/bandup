# Hardening pontual de public.band_members — candidata local revisada

NAO aplicada. Preparada para revisao e futura execucao pontual autorizada.
O historico remoto divergente impede usar db push indiscriminadamente; nao e
necessario reaplicar migrations antigas para esta revogacao isolada.

## Evidencias reutilizadas

Authenticated possui INSERT/UPDATE diretos, sem grant option; postgres conserva
INSERT/UPDATE. Nao ha grants por coluna ou PUBLIC. Authenticated nao herda
postgres/supabase_admin. Frontend usa DELETE direto, sem INSERT/UPDATE/UPSERT.
Criacao, aprovacao e saida usam SECURITY DEFINER owner postgres, row_security=off.
Essas evidencias nao foram recolhidas novamente. Os testes anteriores passaram
15/15 na fixture; a versao revisada exige nova rodada somente do teste isolado.

## Escopo e guardas

Unica alteracao: REVOKE INSERT, UPDATE de authenticated na tabela, com RESTRICT.
Transacao atomica, lock_timeout=3s e statement_timeout=30s. Erro aborta a
transacao; executor deve parar no erro e encerrar com ROLLBACK, sem continuar
fragmentos. SELECT, DELETE, dados, policies, funcoes e triggers ficam intocados.

Preflight verifica tabela comum/RLS, ausencia de heranca de tabela, executor
owner/superuser, ACL de escrita confirmada, ausencia de grant por coluna e
acesso do cliente a ownership/papeis privilegiados. ACL inesperada aborta sem
ampliar revogacoes. Mantida checagem conservadora MEMBER para clientes/anon:
inclui papeis potencialmente alcancaveis por SET ROLE mesmo sem heranca atual.

Apenas tres funcoes precisam existir sem overload ambiguo, com SECURITY DEFINER,
owner postgres e row_security=off. Verificar capacidades em band_members:
- add_band_creator_as_admin: INSERT.
- bandup_decide_entry: SELECT e INSERT; authenticated deve manter EXECUTE.
- bandup_leave_band: SELECT, UPDATE e DELETE; authenticated deve manter EXECUTE.

Owner deve ter bypass de RLS ou ser dono da tabela sem FORCE. row_security=off
sozinho nao da bypass. Posflight confirma capacidades necessarias dos owners,
INSERT/UPDATE de postgres, ausencia de escrita efetiva de tabela/coluna via
clientes e memberships e igualdade de SELECT/DELETE para todos os papeis.

Removidos: manifesto e hashes de corpos/policies/triggers, inventario de todos
os definers public/private, requisito de bandup_delete_band e exigencia de
todos os DML para cada funcao. Esses objetos nao sao modificados pelo REVOKE.
A existencia/semantica dos fluxos foi confirmada, nao revalidada por hashes.
A candidata nao e uma auditoria completa de caminhos indiretos de escrita.

## Limites e caminho para aplicacao

Preserva a sucessao automatica existente na saida; nao cria promocao arbitraria.
Grants futuros podem reativar policies permissivas de INSERT/UPDATE. SQL dinamico,
RPCs e views inseguras preexistentes nao sao corrigidos por esta alteracao.
Nao se afirma que testes sinteticos certificam corpos remotos ou HTTP/Auth real.

Antes da futura execucao, responsavel autorizado deve confirmar destino Demo,
executor apto, janela breve para lock exclusivo e ausencia de alteracoes
concorrentes de roles/ACL/DDL. Usar evidencias existentes e deixar as guardas
transacionais detectar divergencia, sem repetir coleta geral. Falha implica
rollback, nunca conceder privilegios ou editar policies para fazer o gate passar.
Depois de aplicacao autorizada: conferir ausencia de INSERT/UPDATE efetivos,
SELECT/DELETE preservados e fluxos principais em validacao funcional controlada.
Nao reabrir grants automaticamente se houver regressao.

A candidata permanece fora de supabase/migrations. O arquivo inventory.sql
historico e apenas referencia; hashes e coleta ampla nao sao mais requisitos.