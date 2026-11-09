# Encontrar Bandas: revisao das definicoes reais

Status: candidata revisada para leitura humana; NAO executada nem autorizada para aplicacao.

## Evidencia e protecoes preservadas

Referencia imutavel: bandup_rpc_definicoes_instaladas.sql, SHA-256 956a1db6cbad8beddc020bd7f3cf7386963052cff8edac11143933b18c21de12.
Os dois corpos completos foram lidos como texto, nunca executados. O arquivo confirma assinaturas, PL/pgSQL, SECURITY DEFINER, search_path vazio e row_security=off. O arquivo nao inclui owner nem GRANT/REVOKE. Nesta auditoria final, o responsavel confirmou diretamente no Supabase, para ambas as funcoes: owner postgres, SECURITY DEFINER true e proacl {postgres=X/postgres,authenticated=X/postgres}. Essa confirmacao tem origem no relato do responsavel; nao foi feita conexao ao banco nesta tarefa. A migration captura os metadados reais no momento de uma futura aplicacao e exige sua igualdade depois, incluindo OID, assinatura, owner, ACL, defaults, configuracoes e volatilidade; nao altera nenhuma concessao.

A solicitacao conserva literalmente todo o corpo, exceto o predicado de elegibilidade da banda:
- auth.uid() nao nulo e nome aparado de 1 a 80 caracteres;
- isolamento READ COMMITTED, sem mudar snapshots para favorecer quotas;
- pg_try_advisory_xact_lock(824711, hashtext(actor::text)), nao bloqueante e por solicitante entre todas as bandas;
- lock FOR UPDATE na banda e erro se a banda nao existir;
- recusa de quem ja e integrante e de pedido pendente duplicado, antes das quotas;
- maximo de 5 pendentes, 10 pedidos em 24 horas (todos os estados) e cooldown de 10 minutos para a mesma banda;
- clock_timestamp(), INSERT e retorno do mesmo UUID;
- indice unico, RLS, permissoes e funcoes de aprovacao, recusa e cancelamento intactos.

Sai somente a exigencia de haver linha em band_join_directory com accepting_requests. A banda ainda precisa existir e a entrada continua dependendo da aprovacao administrativa.

## Contrato unico e privacidade

Frontend e migration usam APENAS public.bandup_discover_bands(p_after uuid, p_limit integer). Nenhuma bandup_search_bands e criada. Se esse nome inesperadamente existir no destino, a candidata aborta para revisao, em vez de remover um objeto desconhecido.

Para nao excluir/recriar a funcao instalada ou quebrar clientes existentes, o retorno SQL continua TABLE(band_id uuid, display_name text, summary text). A nova consulta seleciona apenas bands.id, bands.name e uma constante vazia para summary. Portanto, apenas ID/nome carregam informacao; nenhuma descricao privada ou dado de integrante/tarefa/evento e consultado. O servico converte display_name para name e descarta todos os outros campos. Alterar o tipo de retorno exigiria excluir/recriar a funcao, o que e desnecessario aqui.

O limite original de 1 a 50 por chamada permanece. O cliente solicita 20 por pagina, ordena pelo mesmo cursor UUID e processa ate cinco paginas por lote, com botao de continuacao. Busca por nome ignora caixa/acentos; busca por ID corresponde ao UUID completo, ignorando caixa e espacos externos. Nomes repetidos sao mantidos por UUID e a interface exibe os IDs para distinguir bandas homonimas.

Toda banda existente participa da mesma consulta, sem opt-in de descoberta. Para catalogos maiores que 100 bandas, a pesquisa continua em lotes pelo botao, sem fingir esgotamento quando ha cursor. A pesquisa ainda filtra no cliente; busca textual no servidor e otimizacao futura, nao requisito desta correcao.

## Preflight e limites da revisao

A candidata compara os corpos instalados com as duas referencias completas, aceitando somente diferencas CRLF/LF. Mudanca de logica, espacos, assinatura, configuracoes, retorno, sobrecarga ou owner inesperado aborta toda a transacao. O executor deve ser o postgres ja autorizado e dono das funcoes, com bypass existente; nada e elevado para fazer o preflight passar. Ambos os patches e suas verificacoes pertencem a uma unica transacao.

Nenhuma tabela, linha, indice, politica, permissao ou outra RPC e criada/alterada/removida. Funcoes de configuracao antigas permanecem sem chamadas na interface; seus dados nao sao apagados. A trava de desenvolvimento local, opt-in, projeto exato e loopback e o bloqueio de producao permanecem identicos.

Testes estaticos comparam a referencia inteira e demonstram que so os dois trechos revisados mudam. Testes com mocks cobrem bandas sem diretorio, aceitacao desativada, nomes repetidos, IDs, paginacao, integrante existente, duplicidade, administracao entre bandas e historico. Nao comprovam autorizacao ou concorrencia no banco real.

Antes de qualquer aplicacao futura: reconferir o projeto, backups, atualidade das definicoes e dos metadados confirmados, indice unico de pendentes e autorizacao funcional com sessoes de teste. Nao rodar este arquivo para testar. Qualquer escrita ou aplicacao requer outra etapa expressamente autorizada. A nova regra so funcionara no Demo apos revisao e aplicacao futura; o frontend isolado nao remove o filtro da RPC atualmente instalada.


## Auditoria final de permissoes e aplicabilidade

Foi corrigida a lacuna de preservar qualquer ACL existente sem exigir a ACL aprovada. Agora o preflight exige exatamente duas entradas EXECUTE, concedidas por postgres a postgres e authenticated, ambas sem opcao de concessao. ACL nula/default, PUBLIC (OID zero), anon, service_role ou outro destinatario direto causam abortamento, sem tentar corrigir permissoes. A contagem junto com a verificacao de destinatarios e privilegios impede entradas extras; os testes estaticos verificam guardas de ausencia/duplicidade de destinatarios e configuracoes inesperadas; nao executam o predicado no PostgreSQL.

As permissoes efetivas sao verificadas antes e depois: postgres e authenticated devem executar, authenticated nao pode conceder, anon e service_role nao podem executar nem por heranca. O postcheck integral da metadata exige o mesmo owner postgres, SECURITY DEFINER true, ACL, assinatura, volatilidade, defaults e configuracoes. Os defaults esperados tambem sao validados: cursor NULL::uuid e limite 20 na descoberta, nenhum default na solicitacao. Nao ha GRANT/REVOKE, ALTER OWNER, desativacao de RLS/triggers ou ampliacao de acesso a tabelas.

A restricao refere-se a ACL da funcao e aos papeis de API conferidos. Superusuarios e privilegios administrativos implicitos do PostgreSQL nao podem ser abolidos por uma ACL, e outros papeis que herdem authenticated exigem auditoria de memberships fora do escopo; nao se deve prometer isolamento de superusuarios. Nenhuma membership e alterada.

Sobre o estado confirmado, a estrategia e compativel: CREATE OR REPLACE usa a definicao instalada com o mesmo OID, assinatura e tipo de retorno, preservando dependencias e permissoes. Duas substituicoes ficam na mesma transacao; qualquer divergencia desfaz ambas. A candidata nao e idempotente: reaplicacao depois do patch aborta pela comparacao do corpo, evitando tratar migrations historicas como scripts de reaplicacao.

A conclusao e uma auditoria estatica, nao uma prova de execucao. A aplicacao ainda depende de o banco continuar identico a referencia e de os preflights passarem, incluindo privilegios efetivos e ausencia de RPC concorrente. Uma recusa do preflight deve ser investigada; nao remover guardas para fazer a migration passar. Testes funcionais de RLS, concorrencia e atomicidade no Supabase continuam em etapa futura expressamente autorizada.
