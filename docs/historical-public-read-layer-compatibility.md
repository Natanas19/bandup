# Camada pública histórica versus laboratório de compatibilidade

Atualização de 29/10/2026: os artefatos da reprodução foram preparados no
[roteiro independente](historical-public-read-layer-lab.md), sem execução SQL.
O gate permanece desabilitado até revisão de um novo cluster. As propostas de
alteração de migrations abaixo continuam apenas propostas, sem implementação.

Revisão documental de 28/10/2026, branch `feature/security-record-ownership`.
Nenhum SQL foi executado e nenhum banco foi acessado nesta etapa. As propostas
abaixo não alteram migrations, fixtures, geradores, testes ou ledger.

## Evidência e limites

A leitura offline anterior de
`C:\Users\Usuário\BandUp-Backups\bandup-pre-migrations.dump` encontrou no ledger
arquivado `supabase_migrations.schema_migrations` a versão `20261004120000`, nome
`public_read_layer`, com um array de **19 statements**, lidos integralmente.
Isso é evidência direta do conteúdo registrado no backup, não do arquivo SQL
original, de seu commit, de sua procedência ou do estado atual de produção.
O arquivo original permanece ausente; o conteúdo registrado deixou de ser
inteiramente desconhecido. A M6 local continua independente.

Os [resultados anteriores do laboratório](compatibility-lab-evidence.md) são
preservados como sucesso informado pelo usuário para a fixture sintética usada.
Eles não comprovam execução dos bytes arquivados nem fidelidade ao histórico.
Comentários, separadores e transações não preservados no array não podem ser
inventados para afirmar recuperação integral do arquivo original.

## Contratos comprovados nos statements

| Statements | Contrato registrado | Limite de segurança |
| --- | --- | --- |
| 1–2 | Cria `bandup_public_reader NOLOGIN NOINHERIT NOBYPASSRLS`; concede membership ao executor | Não há revogação dessa membership no array; NOLOGIN não impede uso por membros |
| 3 | Adiciona `bands.is_public boolean NOT NULL DEFAULT false` | Bandas existentes e novas começam privadas; não cria guard administrativo de publicação |
| 4 | Concede `USAGE, CREATE ON SCHEMA public` ao reader | CREATE permanece sem revogação posterior no array |
| 5–7 | SELECT por coluna em bandas, links e eventos | Não concede acesso a tarefas/membros; grants preexistentes não são inventariados por esses comandos |
| 8 | Revoga privilégios de tabela de `anon` e `PUBLIC` nas três fontes | Não comprova ausência de grants por coluna ou acessos herdados anteriores |
| 9 | Política SELECT de bandas exige `is_public IS TRUE` | Depende de RLS e do restante das políticas já existentes |
| 10 | Política SELECT de links exige banda pública | Não há flag individual do link nem validação de URL |
| 11 | Política SELECT de eventos exige `start_at >= now()` e banda pública | A restrição temporal existe na política, além da view |
| 12–14 | Cria `public_bands`, `public_social_links`, `public_events`, com `security_barrier=true`, `security_invoker=false` | Projeções limitadas; eventos futuros; links de bandas públicas sem filtro de URL |
| 15–17 | Transfere as três views ao reader | Segurança depende de owner sem bypass/ownership de fontes e de RLS habilitada |
| 18–19 | Revoga privilégios nas views de `anon`, `authenticated`, `service_role`, `PUBLIC`; concede SELECT somente a `anon` | Não concede SELECT diretamente a `authenticated`; acesso efetivo herdado exige evidência separada |

Os statements não habilitam RLS, não criam funções ou triggers e não comprovam
defaults globais de privilégios, memberships externas ou alterações posteriores.
CREATE significa capacidade de criar objetos no schema; não é autorização
demonstrada para substituir qualquer objeto existente. A membership do executor
é outro caminho de acesso que precisa ser inventariado.

## Comparação com as fontes atuais

| Aspecto | Histórico arquivado | Fixture sintética e propostas atuais |
| --- | --- | --- |
| Política de eventos | Futuro e banda pública | `legacy_publication_fixture.sql` usa somente banda pública na política; mantém futuro na view. O contrato compartilhado de Bridge e Url exige essa política sem o predicado temporal |
| CREATE do reader antigo | Concedido e não revogado no array | Fixture revoga CREATE; Bridge/Url rejeitam leitor com CREATE |
| Membership do executor | Concedida e não revogada no array | Fixture não concede; contrato admite entrada do executor atual sem ADMIN OPTION, mas não memberships arbitrárias ou herança de outras roles |
| SELECT nas views antigas | Grant direto somente para anon | Fixture concede a anon e authenticated; Bridge exige acesso efetivo de ambos e limita ACLs |
| Revogação nas fontes | Revoga privilégios de tabela de anon e PUBLIC nas três fontes | Fixture depende dos grants de bootstrap/M1–M6 e não reproduz esse comando; ausência de acesso direto deve ser comprovada separadamente, inclusive por coluna |
| Flag dos links e URLs | Todos os links de banda pública elegíveis, sem filtro de URL | Bridge acrescenta flag privada por padrão e restringe política/view antiga; Url acrescenta validador, trigger e filtros nas projeções |
| Perfil agregado | Não existe | M7 cria `public_band_profiles`; Bridge também cria, com reader exclusivo `bandup_profile_reader` |

M6 acrescenta os guards de ownership de eventos e de banda em memberships;
não cria a camada pública nem substitui a versão histórica. M7 original colide
com a role e a coluna existentes e deve abortar; não é uma atualização aplicável
diretamente ao histórico. M7 remove seus privilégios temporários de setup,
adiciona publicação individual de links e guards administrativos.

Bridge preserva as interfaces antigas e acrescenta isolamento do perfil, flags
e guards. Url depende desse contrato e protege URLs; não reconcilia o histórico.
A ordem continua Bridge → Url → M10, com M6/M8 prévias e M7/M9 originais excluídas.
Nenhuma dessas relações implica equivalência de arquivos ou autorização de execução.

## Cenários atuais que não reproduzem o histórico

- O baseline positivo de NegativeBridge valida uma política de eventos mais
  ampla que a arquivada. O histórico deve ser rejeitado pelo contrato atual,
  mesmo que a restrição adicional seja legítima e mais forte.
- Os baselines negativos pressupõem CREATE já revogado. Não demonstram uma
  transição aprovada a partir do privilégio persistente histórico.
- Publication/Profiles/UrlTests exercitam o acesso definido pela fixture e pelas
  etapas seguintes; não comprovam o acesso histórico somente de anon às views.
- A fixture não reproduz a membership persistente do executor nem todos os
  comandos históricos de revogação. O bootstrap sintético não prova o ambiente
  original de memberships e defaults.
- Consultar apenas `public_events` pode esconder a diferença da política RLS,
  pois a própria view já filtra eventos passados nos dois modelos.
- Interstage, corpus de URLs, FunctionalTests e revalidação após M10 continuam
  evidências úteis para o cenário sintético, sem validar a entrada histórica exata.

## Ajustes mínimos propostos: reprodução e testes

Proposta futura, sem implementação nesta revisão: manter a fixture atual como
cenário sintético identificado e acrescentar um cenário histórico separado,
com correspondência explícita aos 19 elementos arquivados. Não reaplicar no
laboratório já migrado nem usar o banco restaurado sem autorização própria.

1. Reproduzir a restrição temporal na política de eventos e na view; grants por
   coluna, opções, owners, revogações e grants das views conforme o array.
2. Reproduzir CREATE e membership persistentes no cenário de entrada, sem
   normalização silenciosa. Isolar roles no destino descartável; registrar o
   executor e suas capacidades. O array não fornece todo o ambiente inicial.
3. Separar dados de teste das operações históricas. Usar eventos passado,
   presente e futuro, bandas públicas/privadas e links de ambos os tipos.
4. Primeiro esperar rejeição do Bridge atual, com motivos específicos. Isolar
   cada diferença em casos próprios, pois o primeiro erro pode mascarar os demais.
5. Testar eventos diretamente sob o reader e pela view como anon; não conceder
   fontes a anon para isso. Na fronteira temporal, usar referência transacional
   determinística; comparar política e view, inclusive `start_at = now()`.
6. Conferir grants diretos e privilégios efetivos separadamente para anon,
   authenticated, service_role, reader e executor. Testar ausência de acesso
   direto às fontes e grants por coluna; não fabricar memberships de aplicação.
7. Preservar as rejeições por PUBLIC, bypass, escrita, ownership de fontes,
   grants excessivos e memberships não revisadas. Acrescentar mutação que remova
   o filtro temporal para comprovar que a restrição histórica não é perdida.
8. Após eventual transição revisada, repetir Interstage, negativos nas fases
   corretas, Publication, Profiles, UrlTests e FunctionalTests; repetir as três
   suítes públicas após M10. Registrar versões, hashes, saídas e baselines.

## Possíveis mudanças nas propostas: decisão separada

Nenhuma mudança de fixture, isoladamente, torna o Bridge atual compatível.
Não remover checks de CREATE, ACL, política ou isolamento para fazê-lo passar.

- **Eventos:** considerar aceitar exatamente a variante histórica revisada,
  preservando seu predicado temporal. Atualizar de forma sincronizada os
  contratos de Bridge/Url, gerador e negativos, sem aceitar predicados arbitrários
  ou descartar restrições adicionais. Isso exige revisão e implementação próprias.
- **CREATE:** continuar rejeitando o estado inseguro. Uma eventual transição
  explícita deve remover apenas o privilégio revisado, registrar antes/depois e
  ser autorizada separadamente; não fazer reparo implícito dentro de um preflight.
- **ACLs:** decidir se preservar as views antigas como anon-only e relaxar apenas
  a exigência de acesso de authenticated é compatível com os consumidores, ou
  se ampliar o acesso será uma mudança de produto autorizada. Não conceder SELECT
  a authenticated apenas para satisfazer a fixture atual.
- **Membership:** inventariar quem é o executor e quem pode assumir o reader;
  decidir preservação ou retirada explicitamente, sem revogar grants desconhecidos.

Essas opções não são migrations prontas nem recomendação de reparo do ledger.
Até a decisão, os preflights atuais devem continuar abortando nas divergências.

## Riscos e critérios objetivos de aprovação

Uma proposta só poderá ser considerada compatível com este histórico quando:

- houver rastreabilidade dos 19 statements e das representações analisadas,
  sem atribuir seus hashes ao arquivo original;
- cada divergência tiver decisão explícita, baseline de entrada e pós-condição;
- a restrição temporal histórica permanecer na política e na view, com testes
  de fronteira e rejeição da mutação que a retire;
- reader final não tiver CREATE, bypass, ownership das fontes, escrita ou
  memberships não revisadas; grants das projeções forem mínimos;
- políticas PUBLIC e acessos diretos indevidos às fontes continuarem rejeitados;
- acesso anon-only versus authenticated tiver decisão aprovada e testes de ACL
  direta e efetiva, sem depender de herança não documentada;
- banda privada ou link privado nunca aparecer nas projeções; URLs inseguras
  não forem publicadas; o intervalo Bridge/Url permanecer protegido;
- preservação de dados, IDs, publicações de bandas, owners, ACLs e objetos
  não afetados for demonstrada, incluindo ausência de reparos silenciosos;
- os testes da entrada histórica e do cenário sintético passarem separadamente,
  com evidências vinculadas aos bytes executados, em etapa autorizada.

Passar nesses critérios não libera produção. Permanecem o arquivo original e
sua procedência não comprovados, ledger não reconciliado, validação de produção,
Auth/PostgREST, concorrência e recuperação pendentes. `supabase db push` permanece
bloqueado. Ocultar links antigos é alteração deliberada a comunicar; caches já
entregues não são recolhidos pelos filtros do banco.

## Identificação das representações analisadas anteriormente

Hashes calculados na leitura offline anterior, registrados aqui sem afirmar que
identificam o arquivo original. UTF-8 sem BOM nas representações textuais; sem
newline final salvo quando especificado. Os bytes do dump não foram alterados.

| Representação | SHA-256 |
| --- | --- |
| Bytes do dump local | `0ce7f630719d36396cfa5336960a92699210c11b5c6f5d805c47bc24a0929e96` |
| Campo statements emitido pelo COPY offline, escapado, sem separadores da linha | `b53f9b6e33c4e53b7999bea4d0d1ec7c651fb574a3c63192fff5976491670049` |
| Texto do array após decodificação dos escapes COPY | `4c11a511ad8b89b902d4cf603c4ce131419a335fd4590d7590abd49a3ea0a446` |
| 19 elementos decodificados; JSON por `json.dumps(items, ensure_ascii=False, separators=(',', ':'))` | `51437fbe5bebfd41b6baac17d4be80956d7b952d4a385aa84f52391b50706445` |
| Texto de revisão em memória por `';\n\n'.join(items) + ';\n'` | `1d665532c01e670ca8f21c41d564b209408349c49f5530a85e9f361eec8fa3bd` |

A última representação acrescentou separadores em memória; nenhum arquivo de
migration foi reconstruído. Os hashes locais das migrations comparadas constam
do [inventário anterior](compatibility-lab-evidence.md), sem comprovação de que
esses bytes foram executados. Os resultados e alertas anteriores permanecem
válidos dentro do escopo em que foram registrados.
