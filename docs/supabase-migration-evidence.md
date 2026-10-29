# Migrations 9/10: reconciliação das evidências locais

## Atualização de evidências — 28/10/2026

O usuário confirmou a execução bem-sucedida do laboratório de compatibilidade em
PostgreSQL 17.11, porta 5434: M1–M6 e M8, fixtures sintéticas, Bridge → Url → M10
e suítes nas fases previstas. Após M10, Publication, Profiles e UrlTests foram
repetidas com ROLLBACK e sem erros; FunctionalTests também passou após M10.
Esta consolidação não executou SQL nem acessou bancos. O [registro consolidado](compatibility-lab-evidence.md)
distingue o relato confirmado dos hashes dos arquivos atuais; não há logs ou
hashes comprovadamente executados anexados. Produção permanece bloqueada: artefato
20261004120000 ausente, ledger não reconciliado, validação de produção pendente e
`supabase db push` bloqueado.

Os avisos de preparação/não execução e contagens abaixo são registros históricos
das respectivas revisões, não o estado atual do ensaio informado.


Esta é uma revisão de arquivos do repositório, não uma sessão SQL nem um relatório
de execução em banco. Não foram acessados serviços, diretórios de laboratório ou
containers. A busca local de relatórios considerou `docs/` e `supabase/tests/`;
nenhum resultado remoto ou arquivo de outro projeto foi inferido.

## Conclusão documental

O usuário informou validação posterior das duas migrations em PostgreSQL isolado.
Os relatos presentes neste checkout ainda não contêm a evidência final que ligue
esse resultado aos hashes atuais dos arquivos e à revisão final dos gates/suítes.
Não há base documental local para declarar a suíte revisada integralmente aprovada
ou a Migration 10 executada com sucesso por uma fonte independente desse relato.
Isso é uma lacuna de rastreabilidade, não uma afirmação de que o teste informado
não aconteceu ou de que a migration falhou.

| Fonte existente | Evidência efetivamente registrada | Limite mantido |
| --- | --- | --- |
| `supabase/tests/external_link_url_safety.md`, seção Test procedure revision | Corpus anterior com 86 casos SQL aprovados; fixture antigo falhou por privilégio EXECUTE; versão posterior usa o trigger real | Corpus parcial não equivale à suíte final aprovada. O relato posterior ainda está marcado como preparado/não executado |
| `supabase/tests/functional_integrity.md`, seções Prepared tests / Explicit test target | Corpus e contratos offline; fixture legado deliberadamente com COMMIT e suíte com ROLLBACK preparados; gate revisado não executado nesse registro | Não contém saída final SQL da 10 ou comparação final de dados/catálogo após a execução informada |
| `supabase/tests/sql_test_execution.md` | A revisão do gate de identidade não foi executada nessa preparação; roteiro separa fixture, migration e suítes | É plano de execução, não comprovação de aprovação; SQL-only não testa Auth/PostgREST |
| `supabase/tests/public_band_profiles.md` e `record_ownership_guards.md` | Sete migrations históricas aplicadas em PostgreSQL 17.11 mínimo; duas suítes em sessões separadas, exit code 0 e ROLLBACK; contagens posteriores preservadas conforme relato | Não comprova Migrations 8–10, revisão atual dos gates, Supabase completo ou produção |
| `docs/auditoria-final.md` | Preparação anterior com 197 testes JavaScript e build isolado aprovados | Não é execução das migrations pelo PostgreSQL; não foi repetido build nesta revisão |
| Informação posterior do usuário | Migrations 9/10 validadas em laboratórios PostgreSQL isolados | Confirmar escopo, arquivos exatos, versão, saída final, papéis e baselines no relatório já existente, sem reabrir o laboratório nesta etapa |

Não se deve substituir os relatos históricos por “aprovado” nem somar execuções
de versões distintas como se fossem a mesma suíte. Os avisos de revisão posterior
preparada continuam válidos como descrição das etapas às quais pertencem.

## Verificações offline desta revisão

Comando executado somente no checkout local:

```text
node --test tests/external-link-url-safety.test.cjs tests/functional-integrity.test.cjs
```

Resultado: **13 testes aprovados, zero falhas**, sem SQL ou rede. Esses testes
comparam corpus JavaScript, contrato das fontes SQL, preservação de definições e
estrutura de fixtures/suítes. Não fazem parse/compilação SQL no PostgreSQL, não
executam triggers e não validam ACL/RLS em runtime. Não são evidência de produção.

A inspeção estática do diagnóstico verifica comandos permitidos, isolamento das
fases, ausência de deparsers/chamadas da aplicação e funções internas permitidas.
O verificador [check_supabase_readonly.py](check_supabase_readonly.py), executado
com `python docs/check_supabase_readonly.py`, conferiu **28 instruções estruturais**
e **24 instruções da fase de dados**; **12 mutações negativas foram rejeitadas**,
incluindo escrita, função desconhecida, lock explícito, leitura de negócio na fase
estrutural e ausência de ROLLBACK. Passaram ainda **24 casos offline** do limite
UTF-16 da expansão limitada; a categoria IPv6 inconclusiva foi preservada.
Isso não é um parser PostgreSQL nem comprova a semântica do servidor. O verificador
não importa cliente SQL, não abre conexão, não usa subprocessos e não escreve arquivos.

## O que falta do relatório final existente

1. Data, versão/encoding PostgreSQL e identificação não secreta do alvo isolado.
2. SHA-256 das migrations, fixtures, corpus, suites e include efetivamente usados.
3. Execução por etapa, saída final/exit code e SQLSTATE esperados; falhas preservadas
   e explicação de revisões posteriores, sem corrigir o histórico retroativamente.
4. Snapshot do catálogo e contagens/comparações de dados antes/depois, incluindo
   owner/ACL/RLS/políticas/constraints/view e total esperado de triggers 10 → 11 → 16.
5. Papéis/capacidades do executor e das identidades testadas; cobertura de legado,
   atomicidade, isolamento e limites de concorrência/HTTP explicitados.

Não é necessário acessar bancos para anexar/reconciliar esse relatório já
produzido. Até isso ocorrer, o resultado informado permanece identificado como
relato do usuário; validação de produção, permissões reais, backups/restauração,
compatibilidade do código publicado e impacto nos legados continuam pendentes.

## Revisão local das fontes: SHA-256

Os hashes abaixo identificam os arquivos lidos agora, **não** os arquivos
comprovadamente executados no laboratório. Não implicam resultado SQL aprovado.

| Arquivo local | SHA-256 |
| --- | --- |
| `supabase/migrations/20261027000000_external_link_url_safety.sql` | `a820214419c5d85380ad71b9d402e79b33a0347af4317af0593bcdc2125e963d` |
| `supabase/migrations/20261027010000_functional_integrity.sql` | `d74a4fbaf3fa5701a39169071112aa0be0d32741d813f0c5ee8e359abf582794` |
| `supabase/tests/external_link_url_safety.sql` | `9b06acc8414e32ad328d5c9b6a535c380b77b7dc4df7ac68dea712d87eca5aac` |
| `supabase/tests/external_link_url_cases.json` | `1f0a511fe3359f0c40dced8cd966462e1659c2b4585953179a32e2a93f949e35` |
| `supabase/tests/functional_integrity.sql` | `a3ac675d5ab9a8c3a278a1dbb33173fc9b53cfea36e368b162a1c9f58e90b1e4` |
| `supabase/tests/functional_integrity_legacy_fixture.sql` | `b2a108a3eb58af9c7ee6ea5e5f436d27ea688da1e5762b3d55d9730fa5f28b0f` |
| `supabase/tests/functional_integrity_cases.json` | `cbf23e4c8396b434999cd90e2f87c66c894feb06b824a3c4a134e19a05f02d1d` |
| `supabase/tests/sql_test_capabilities.sql` | `b76a3d4efd92f2724fdaf7d0fcd8721a8ed4d8baaccadf3dd01b538a1fcb3a61` |
| `supabase/tests/public_band_profiles.sql` | `a6ac20e0ee569e3f06ade202fd46ef0d3ec8964494828465d0a6e56fb897a21c` |
| `supabase/tests/record_ownership_guards.sql` | `428373a9bc184981c555dfe49af7bb554bbbbbae24c79afc1a50f11b5466d7e1` |
| `tests/external-link-url-safety.test.cjs` | `a2e2657fcec1021eaacf30e4442aacbc0843a30d68713f689627bf9fd1c7de21` |
| `tests/functional-integrity.test.cjs` | `7206a1f7587018e5f146da55a36d8096d6b37708a2e7a895f3bdd1a93e4519f8` |
