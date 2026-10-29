# Evidências do laboratório de compatibilidade — 28/10/2026

Branch: `feature/security-record-ownership`. Laboratório descartável informado:
PostgreSQL **17.11**, **127.0.0.1:5434**.

## Descoberta posterior: conteúdo histórico arquivado

A leitura offline posterior do dump identificou a versão `20261004120000`, nome
`public_read_layer`, e seus 19 statements no ledger arquivado. O arquivo original
e sua procedência permanecem não comprovados. A [comparação histórica](historical-public-read-layer-compatibility.md)
documenta diferenças de política temporal de eventos, CREATE/membership
persistentes e ACLs das views. O sucesso abaixo continua sendo o resultado
informado do cenário sintético; não comprova compatibilidade com essa entrada
histórica. Os registros de ausência anteriores se referem ao arquivo original,
não à inexistência de conteúdo recuperável no backup.

## Origem e limites

Resultados confirmados pelo usuário nesta conversa; nenhuma conexão ou execução
SQL foi realizada nesta consolidação. Não foram fornecidos logs completos,
horários por etapa, snapshots finais ou hashes dos artefatos executados.
Não se atribui SHA do Git, exit code ou contagem observada sem evidência.
O relato positivo não comprova equivalência entre os bytes executados e os atuais.

## Sequência e resultados informados

| Fase | Artefato/seleção | Resultado confirmado |
| --- | --- | --- |
| Pré-requisitos | M1–M5 → M6 → M8 | Aplicadas no laboratório |
| Após M8, antes das fixtures | PostM8 | Sem erros; ROLLBACK |
| Legado sintético | LegacyFixture → UrlFixture | Sucesso; COMMIT conforme o plano |
| Antes de Bridge | NegativeBridge | Sem erros; ROLLBACK |
| Compatibilidade | Bridge | Sucesso; COMMIT |
| Intervalo antes de Url | Interstage → NegativeUrl | Sem erros; ROLLBACK |
| Segurança de URLs | Url | Sucesso; COMMIT |
| Após Url | Publication → Profiles → UrlTests | Sem erros; ROLLBACK por suíte |
| Antes de M10 | FunctionalFixture | Sucesso; COMMIT conforme o plano |
| Integridade | M10 | Sucesso; COMMIT |
| Após M10 | FunctionalTests | Sucesso; ROLLBACK conforme o plano |
| Revalidação após M10 | Publication → Profiles → UrlTests | Repetidas; sem erros; ROLLBACK por suíte |

A ordem explícita do manifesto é Bridge → Url → M10, com M6/M8 como
pré-requisitos. Não é a ordem por timestamp. M7/M9 originais são alternativas
excluídas deste ramo. A tabela não prescreve repetição das etapas concluídas nem
comprova registro no ledger. Bootstrap/BootstrapChecks não recebem atestado
individual nesta consolidação. Os registros anteriores de falha de NegativeBridge
e de preparação permanecem históricos; o sucesso posterior foi informado pelo
usuário, sem comprovação por hash da versão executada.

## SHA-256 dos SQLs atuais

Calculados localmente em 28/10/2026 sobre os bytes atuais, incluindo terminadores
de linha. **Nenhum hash abaixo é comprovadamente executado no laboratório.**
Inventário: todas as migrations SQL locais e os SQLs de compatibilidade, fixture
legada e gates/includes correspondentes. Incluir alternativas originais não
significa executá-las ou aprová-las para este ramo. JSONs de corpus, launcher,
manifesto e documentação não estão cobertos por esta tabela de SQL.

| Arquivo atual | SHA-256 local; execução destes bytes não comprovada |
| --- | --- |
| `supabase/migrations/20261001000000_initial_bandup_schema.sql` | `dcbf2b531278316d775a482ae52b629061f70b8897f692a676086ec2d5d8c118` |
| `supabase/migrations/20261002160000_tasks_delete_admins_only.sql` | `bbf3a2aec9bc554494cd3dbef74e20ddcbe47e09e1340db4f8bd02dd324a7182` |
| `supabase/migrations/20261002170000_events_delete_admins_only.sql` | `bca60bded2fa2f8edce085238c3544fccb9912235211872da2c0902d254a0803` |
| `supabase/migrations/20261002190800_events_custom_event_type.sql` | `5ad46a2335f346e108b8f684317f1d153151b46a8573d5a100aa0043a065e65a` |
| `supabase/migrations/20261002200000_tasks_optional_event_link.sql` | `c3d7f3bd632ebf46e0be4f32609e9a6d33116b8fbddfab8fa039e9005f1e1cfb` |
| `supabase/migrations/20261017180000_record_ownership_guards.sql` | `72425154c9463dadc8ec75ff23225e6bdd56b3005c1e2eba519ae758261a2fce` |
| `supabase/migrations/20261020000000_public_band_profiles.sql` | `07da0e6a0348be5e45e096a0d8a965a0b767b3a574a4961c26f110efb624b5c6` |
| `supabase/migrations/20261023000000_tasks_ownership_immutable.sql` | `e100f430b239bc028e08dfc1b2df988844b53345dc0f42d2bd6b0382dc7f5eb8` |
| `supabase/migrations/20261027000000_external_link_url_safety.sql` | `a820214419c5d85380ad71b9d402e79b33a0347af4317af0593bcdc2125e963d` |
| `supabase/migrations/20261027010000_functional_integrity.sql` | `d74a4fbaf3fa5701a39169071112aa0be0d32741d813f0c5ee8e359abf582794` |
| `supabase/migrations/20261028000000_legacy_publication_compatibility.sql` | `487912e60131bc3ebe245b318062b2c48508187cd2119805f6ae0951c2b5251d` |
| `supabase/migrations/20261028010000_legacy_external_link_url_safety.sql` | `c96aa44f14ec7627ff6c0cd511fecba0c098454ed9a054194c19ebc927773a1d` |
| `supabase/tests/compatibility_functional_integrity.sql` | `ab7fe5de3ce46bb64060c2ee41a3adfaba0565688ef60923da8caa0e28328740` |
| `supabase/tests/compatibility_functional_integrity_legacy_fixture.sql` | `402654fd001fb60f9a522eb6b6d44cd02319f4311fdcd5f7a587671ffe66fa3c` |
| `supabase/tests/compatibility_interstage_publication.sql` | `9cbdbbd5f5ad4f144480334aefde65f9c3ea738cbddfffb7f9539eda87d6ddf2` |
| `supabase/tests/compatibility_lab_bootstrap.sql` | `50c87860472e7c675140b486192039f8e73fb817116df5805ef626b62d97a44e` |
| `supabase/tests/compatibility_lab_bootstrap_checks.sql` | `c0c876182ed5022ecede720b92bd0af82ac1419c9bf887bae52b0bd7be4e382e` |
| `supabase/tests/compatibility_lab_identity.sql` | `cc6d443957a3ab50208345f95faba0e8e02728c87a0b4b9a6f57b66f5425087b` |
| `supabase/tests/compatibility_lab_identity_check.sql` | `46a685cccc5f4e86fe29dae271792ade3f9cd2104112783b592dc5a4ea72220b` |
| `supabase/tests/compatibility_negative_bridge.sql` | `b8f59e8fc5a5df57eac2a1792621bbf3c8f85f5859a18d62d93be16cfd315184` |
| `supabase/tests/compatibility_negative_url.sql` | `6e88705e6cedb18f1ae84db0d0a6e81082d9dee4ede597ed63adda5b64c07742` |
| `supabase/tests/compatibility_post_m8.sql` | `427f326a99d687d6f61c34150eeaa22038cb7530a68e458c2da203277a26d14c` |
| `supabase/tests/compatibility_public_band_profiles.sql` | `5aafe51079d713b2fee4fd992c7cca0df7842c1ff950d778883590fa15de0c1d` |
| `supabase/tests/compatibility_url_cases.sql` | `992127c8fd3a157f57d661a79f585afc5d0dd23a62b613acb53903ef74638f52` |
| `supabase/tests/compatibility_url_fixture.sql` | `21473a2de62bc325f1f277776bd3f072c8ff031f1c579956ab27c500d6efc406` |
| `supabase/tests/compatibility_url_safety.sql` | `468819a121839962bc9c61084bfedb85287d9e1241a20abf73b427e6d64827b5` |
| `supabase/tests/legacy_publication_fixture.sql` | `6eb7b64af06832e8d7a80ad616103cc4328a0867f1ba1bb973aacdad2a96b1a6` |
| `supabase/tests/publication_compatibility.sql` | `760f3cb2913a90760125d9efe5e14b6e91dae441d93517c0a53a98fc06a534c1` |
| `supabase/tests/publication_compatibility_target.sql` | `a2082dafeb3ff13274558f9b2fe087f4d5e3b70f518aea8d5258eb360fcd7611` |

## Bloqueios e próximos passos

- **20261004120000 ausente**: a fixture sintética não recupera o artefato histórico
  nem comprova equivalência à camada real.
- **Ledger não reconciliado**: COMMIT manual não comprova lançamento no histórico.
  Não inventar versões aplicadas nem marcar alternativas como executadas.
- **Validação de produção pendente**: schema, ACLs, owners, RLS, memberships,
  dependências, defaults de EXECUTE, versão implantada e consumidores reais.
- **supabase db push bloqueado**: o manifesto não é runner nem autorização de
  publicação; a pasta contém alternativas incompatíveis e timestamps fora da ordem.
- O ensaio sintético não atesta Auth/PostgREST, concorrência ou recuperação/PITR.
  A ocultação intencional dos links antigos exige comunicação aos consumidores.

Reunir logs e hashes já produzidos, se existirem, e associar cada resultado à
versão efetivamente executada, preservando as lacunas. Planejar separadamente a
reconciliação histórica e a validação de produção com autorização própria.
Não reaplicar migrations ou fixtures para fabricar evidência retrospectiva.
