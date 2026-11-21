# Análise offline das permissões da role

Preparado sem conexão ao Supabase ou execução de SQL remoto.

```powershell
node scripts/security-audit/analyze-role.cjs "CAMINHO_DO_ARQUIVO_EXPORTADO"
```

O comando não conecta à rede, não executa psql, não carrega .env e não modifica
roles/grants. Aceita UTF-8 válido, com BOM opcional e limite de 10 MiB. O importador
offline `import-sql-editor.cjs` reconhece JSON puro, JSON de uma linha/uma coluna
do SQL Editor (célula como objeto ou string JSON) e CSV de uma linha/uma coluna de
resultado, além do cabeçalho. CSV aceita vírgula, aspas duplicadas, quebras em campo
entre aspas e LF/CRLF; não suporta separador ponto e vírgula ou arquivos XLSX.
Não aceita transcript TAP/psql, JSON concatenado, múltiplas linhas de resultado,
colunas extras, aspas inválidas, JSON truncado ou célula `[object Object]`.
Não corrige/reconstrói exportações ambíguas. Extensão não determina o formato.
Gera report.json/report.md em diretório novo no TEMP, sem sobrescrever a
entrada. Saída contém mensagens fixas e contagens; nomes, assinaturas, campos extras
e erros brutos não são copiados. O JSON original deve permanecer em local protegido.

## Uso com a exportação do SQL Editor

Após uma coleta separadamente autorizada, baixe **Export → Download CSV** e passe
o arquivo diretamente ao comando acima. Não abrir/resalvar em Excel nem renomear
para JSON: não há etapa de cópia ou conversão manual necessária. Alternativamente,
o conteúdo de **Copy as JSON** salvo em UTF-8 também é aceito, incluindo o array de
linhas usado pelo SQL Editor. Esta automação não abre navegador nem executa a coleta.
O importador normaliza somente em memória e preserva a exportação original; não
salva um segundo arquivo com possíveis campos sensíveis. Apenas o analisador gera
resumos fixos. A validação estrutural não detecta toda omissão ou adulteração:
JSON sintaticamente válido pode ser incompleto, e a origem Demo não é autenticada.

## Contrato e classificações

A consulta role-remaining-checks.sql agora produz formatVersion 2, versão do servidor,
horário, escopo e capacidade SET ROLE. Versão antiga/incompleta/malformada, alvo errado
ou servidor fora de PostgreSQL 17 resulta em NÃO VERIFICADO; sem aprovação parcial.
O JSON é evidência fornecida, não é assinado: campos de origem/horário não provam
autenticidade, completude, identidade do projeto ou privilégios do executor.

- APROVADO: critério delimitado passou nos dados válidos fornecidos; por exemplo,
  atributos administrativos ausentes ou nenhuma membership informada.
- ALERTA: capacidade que exige revisão, incluindo EXECUTE e candidato a chamada direta,
  grant PUBLIC, privilégio de sequência, membership e default futuro relevante.
  Um alerta não significa automaticamente vulnerabilidade ou exploração.
- NÃO VERIFICADO: evidência ausente, vazia, inválida ou cobertura insuficiente.
  Nenhuma lista vazia certifica a segurança completa.

O estado geral nunca é APROVADO: permanece NÃO VERIFICADO ou ALERTA porque origem,
completude e semântica não são certificadas. Exit codes: 1 com alerta, 2 com pendência
ou entrada inválida. Campos exigidos têm tipos estritos: string "false" não é boolean.
Objetos/arrays inesperados nas seções necessárias são recusados integralmente.

## Retorno, privilégios e invocação direta

Os dois coletores (catalog.sql e role-remaining-checks.sql) agora registram
`return_type` por `format_type(prorettype, NULL)`. O formato CSV/JSON v2 é mantido.
No analisador da role, o campo é opcional para compatibilidade com exportações
antigas: ausente ou NULL significa retorno desconhecido; valor presente inválido
recusa o relatório. Nunca inferir retorno por nome ou por fingerprint.

`execute` conserva as contagens de EXECUTE efetivo e, separadamente, USAGE no schema.
EXECUTE não é prova de explorabilidade. `direct_invocation` distingue retorno
desconhecido, contexto trigger/event_trigger, janela, falta de USAGE e candidatos
a invocação direta. Candidato exige EXECUTE, USAGE e retorno conhecido fora dos
tipos trigger/event_trigger, mas não comprova sucesso: argumentos, pseudotipos,
corpo e dependências ainda podem impedir ou limitar a chamada. Procedures usam
CALL e funções janela exigem seu contexto; não são equiparadas a SELECT comum.

`security_definer` passa a avaliar a rota direta nesses mesmos termos, preservando
a contagem total de definers com EXECUTE. Sem retorno suficiente, fica NÃO VERIFICADO.
APROVADO nessa linha significa somente ausência de candidatos diretos identificados;
não aprova a função, role ou caminhos indiretos. Rotinas trigger/event_trigger geram
`contextual_invocation` NÃO VERIFICADO: vínculos, eventos, DDL permitido, owner e corpo
continuam necessários. `coverage` e `default_privileges` mantêm suas pendências;
o estado geral não é promovido a APROVADO.

A investigação externa de public.rls_auto_enable() informou RETURNS event_trigger,
owner postgres, plpgsql, search_path pg_catalog e vínculo ensure_rls. Esses dados
não são injetados em CSVs antigos nem usados como exceção por nome. Uma nova coleta
autorizada pode fornecer o retorno; esta alteração não executa SQL remoto.

## Revisão de compatibilidade PostgreSQL 17

Revisão estática baseada na documentação oficial, não validação por servidor:
https://www.postgresql.org/docs/17/functions-info.html
https://www.postgresql.org/docs/17/catalog-pg-default-acl.html
https://www.postgresql.org/docs/17/ddl-priv.html

- acldefault usa códigos específicos: banco d, schema n, relação r, sequência s,
  rotina f. defaclobjtype de sequência é S; não confundir os dois códigos.
- ACL NULL é expandida com acldefault; não significa ausência de privilégios.
- pg_has_role admite MEMBER, USAGE e SET; a consulta identifica membership transitiva
  e agora também distingue SET ROLE de disponibilidade automática.
- grantee=0 representa PUBLIC; CASE evita consultá-lo como se fosse uma role real.
- pg_get_functiondef não aceita aggregates; o filtro inclui somente f/p/w e exclui a.
  Rotinas/window functions de schemas internos continuam fora do escopo.
- search_path é restrito a pg_catalog e o SQL não chama rotinas da aplicação.
- Default ACL vazio preserva defaults internos; o analisador nunca o aprova como
  ausência de permissões futuras. Defaults globais/por schema/criador exigem revisão.

Possíveis falhas reais: falta de SELECT nos catálogos, EXECUTE em introspecção,
formato/colunas diferentes do PostgreSQL 17, timeout, alterações concorrentes e
resposta truncada. ON_ERROR_STOP no futuro executor deve impedir usar resultado
parcial. Sem conexão não é possível afirmar que a consulta executa nesse Supabase.
REPEATABLE READ reduz variação de snapshot, mas não é trava contra toda mudança DDL.

## Resultado desta etapa

Nenhum JSON remoto foi recebido ou analisado. Somente fixtures sintéticas são usadas
nos testes. Não repetir provisionamento, habilitar LOGIN, criar grants ou usar uma
identidade administrativa para testar esta análise. Próximo passo: revisar o contrato
e, quando houver coleta explicitamente autorizada, analisar o JSON puro produzido.
