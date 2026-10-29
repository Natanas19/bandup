# Revisão de compatibilidade de publicação — 28/10/2026

As propostas de compatibilidade agora exigem contratos de funções/triggers/ACLs e
M8 anterior ao bridge; um gate impede publicação de links antes da etapa URL.
Foram preparados negativos de preflight e corpus completo nas duas views públicas.
O [roteiro e manifesto do ramo](publication-compatibility.md) prevalecem sobre a
ordem original para o legado. SQL não foi executado; não houve acesso a produção,
commit, push ou deploy. O diff preexistente de `package-lock.json` foi investigado
e preservado, com origem não comprovada. Registros abaixo permanecem históricos.

# Atualização: preparação do diagnóstico de produção

## Revisão local do roteiro em duas fases

A revisão posterior separou fisicamente os [metadados](supabase-production-readonly.sql)
das [contagens e legados](supabase-production-readonly-data.sql), sem execução
automática entre fases. Foram removidos deparsers de definições, pois podem chamar
funções de saída de tipos personalizados; os hashes agora usam campos internos
do catálogo. A fase de dados exige revisão de dependências e autorização posterior.
Foram documentados privilégios, possíveis falhas, locks, custo e limites de sigilo.
IPv6 continua explicitamente inconclusivo. Veja a [reconciliação das evidências](supabase-migration-evidence.md)
e o [plano revisado](supabase-production-readonly.md). Nesta revisão, 13 testes
offline das migrations passaram; isso não é execução SQL nem validação de produção.
O verificador lexical local conferiu 28 instruções de metadados e 24 de dados,
rejeitou 12 mutações negativas e passou 24 casos de limite UTF-16. A fase 1 está
preparada para autorização específica, sem autorização implícita para a fase 2.

O conteúdo abaixo registra etapas anteriores, inclusive a proposta de commits e
avisos de testes ainda não executados naquela ocasião. Os cinco commits locais
foram posteriormente criados. O usuário informou envio ao GitHub, Preview Ready,
Production Branch `main` e validação das migrations 9/10 em laboratórios isolados;
esses estados remotos não foram consultados nesta etapa. Os relatórios SQL locais
ainda não incluem o registro final correspondente à validação informada.

O [plano de diagnóstico somente leitura](supabase-production-readonly.md) reúne a
conferência das evidências, os pré-requisitos e as condições antes de aplicar as
migrations. Seu roteiro SQL está preparado, não executado nem validado por um
servidor PostgreSQL. Não houve conexão, SQL, acesso a laboratório ou alteração de
código/migrations durante sua elaboração. Validação de produção continua pendente.

# Consolidação para preparação do GitHub — 27/10/2026

Esta atualização prevalece sobre o diagnóstico histórico abaixo. A autorização atual abrange ajustes locais e verificações; não autoriza commit, push, banco, laboratório ou deploy.

## Correções concluídas no código local

- Configuração específica de laboratório centralizada em `src/lib/development-lab.ts`, consumida por `next.config.ts`, projeção de imagens e leitor público. Mesmas origens exatas, validações e restrição HTTP a desenvolvimento; sem alteração de permissões.
- Exclusões pontuais em `.gitignore` para os dois scripts Python locais e o SVG demonstrativo sem referências; arquivos preservados, testes oficiais mantidos.
- README regravado em UTF-8 com acentos corrigidos, Node 22, instalação reproduzível, variáveis e ordem completa das dez migrations.
- Mudanças preexistentes incluem proteção de sessão entre abas, segurança de URLs, contraste, declaração de Node e migrations 9/10. Preservadas nesta etapa; presença no código não comprova implantação ou integração real.

## Evidências de laboratório e limites

Nenhum banco, container, laboratório, Supabase ou Vercel foi acessado nesta preparação. Os resultados históricos não são novos testes. A documentação de URLs registra 86 casos SQL aprovados anteriormente, mas também falha do antigo fixture; a revisão posterior das suítes e do gate de identidade NÃO foi executada. A migration 10 e seu fixture permanecem preparados, não executados. Consulte `supabase/tests/sql_test_execution.md` para a distinção entre ambientes e etapas. Não interpretar os achados antigos abaixo como estado atual confirmado.

## Pendências para produção

- Validar migrations 1–10, dados legados, catálogo, grants, RLS e rollback/recuperação em ambiente descartável autorizado; nenhuma migration foi modificada aqui.
- Executar suítes SQL revisadas e testes reais de Auth/PostgREST, isolamento, concorrência, publicação e retirada, expiração e logout entre abas.
- Validar Safari/iOS, acessibilidade e aparência; build e mocks não comprovam esses comportamentos.
- Conferir Node 22, variáveis HTTPS e chave pública do projeto correto no destino, sem transportar endpoints locais.
- Revisão atualizada de vulnerabilidades das dependências e configuração de hospedagem ainda pendente; sem atualização de dependências nesta etapa.

## Proposta de commits (somente revisão futura)

1. `fix(security): harden links and private sessions` — validações, boundary de sessão e regressões correspondentes.
2. `feat(ui): organize workspace and themes` — layouts, navegação, temas, componentes e testes relacionados.
3. `fix(db): prepare URL and functional integrity guards` — migrations 9/10 já existentes e testes/documentação SQL, com execução pendente explicitada; revisar também os ajustes de suítes anteriores.
4. `chore(config): isolate development laboratory settings` — módulo central, três consumidores e testes afetados.
5. `docs: prepare reproducible GitHub setup` — README, auditoria, `.gitignore`, `.nvmrc` e declarações de runtime/dependências preexistentes após revisão de seus diffs.

Revisar trechos compartilhados entre grupos para cada commit ser autocontido. Não incluir scripts locais, SVG sem uso, credenciais ou resultados temporários. Nenhum staging ou commit foi realizado.

## Verificações desta preparação

- Node 22.18.0; 197 testes JavaScript aprovados, zero falhas. Transporte simulado, sem integração real.
- ESLint e TypeScript (`--noEmit --incremental false`) aprovados.
- `git diff --check` aprovado; apenas avisos de normalização LF/CRLF.
- Hashes SHA-256 das dez migrations iguais aos do início desta etapa.
- Revisados 104 candidatos (`git ls-files --cached --others --exclude-standard`): nenhum caminho local sensível ou indício de segredo nos padrões de chaves privadas, chaves secretas Supabase, tokens GitHub, chaves AWS e JWTs. URLs com credenciais aparecem somente em fixtures sintéticos de testes. A busca por padrões não garante ausência absoluta de segredos.
- `git check-ignore` confirmou as três exclusões pontuais. Os arquivos permanecem no disco e os testes oficiais continuam candidatos.
- Build isolado aprovado em `.next/github-preparation-7d502c5b`, sem `.env` local, com URL `.invalid`, chave sintética, telemetria desativada e dependências instaladas compartilhadas por junction. Compilação, lint, tipos e geração das nove páginas estáticas concluídos. Sem execução HTTP do artefato. A primeira tentativa em C: falhou por resolução de dependências via junction entre discos; a repetição em D: passou. Houve aviso de múltiplos lockfiles/raiz inferida na cópia isolada, sem alteração da configuração do aplicativo.
- O pacote Next 15.5.27 instalado não contém `node_modules/next/dist/docs/` nem o gerador de AGENTS mencionado; foram conferidos os tipos instalados e a [documentação oficial de allowedDevOrigins](https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins).

---

## Diagnóstico histórico preservado (anterior às correções acima)

# Auditoria técnica final do BandUp

- Repositório auditado: `D:\Projetos\bandup-dev`.
- Data de consolidação deste relatório: 27/10/2026.
- Origem: diagnóstico completo da auditoria final e sua reapresentação por gravidade, preservados no contexto da conversa.
- Finalidade: registrar o diagnóstico anterior para revisão e preparação de uma versão estável. Este documento não representa autorização para aplicar correções ou publicar.

## 1. Escopo, procedência e limites

O diagnóstico original completo estava disponível. Não foi necessário reconstruir achados por suposição. Para salvar este documento, foram novamente consultados apenas a existência do destino, a branch, o HEAD e o estado do Git. Os resultados de testes abaixo pertencem à auditoria anterior; não foram executados novamente para a criação deste arquivo.

A auditoria original foi somente de leitura. Não acessou produção, banco ou Docker; não executou migrations, reset, build, correções, commits ou deploy. Durante aquela auditoria, o hash conjunto dos 86 arquivos versionados e não rastreados examinados permaneceu igual:

`201425130ec9276f1bfd08fd9e056dd7aeebb9bd08d616088b6f7aa2981bba03`

Esse hash é o registro da comparação realizada naquela ocasião, não uma nova medição feita ao salvar este documento. Nesta etapa foi autorizada somente a criação da pasta `docs` e deste Markdown.

### Verificações registradas na auditoria original

| Verificação | Resultado |
| --- | --- |
| Testes JavaScript com mocks | 142 aprovados; zero falhas |
| TypeScript, sem emissão e sem incremental | Passou |
| ESLint, sem correções automáticas | Passou |
| `git diff --check` | Passou; avisos de normalização de LF/CRLF em arquivos existentes não foram erros de whitespace |
| Build de produção | Não executado, pois gera arquivos |
| Testes SQL e integração real com Supabase | Não executados nesta auditoria |
| Verificação atualizada de vulnerabilidades das dependências | Não realizada |
| Acesso à produção | Não realizado |

HTTP 200 não foi utilizado como prova de funcionamento de autenticação, persistência, permissões ou regras de negócio. Não há percentual de cobertura instrumentada disponível. Os 142 testes não equivalem a cobertura integral.

## 2. Resumo da saúde do projeto

O frontend está consistente e as verificações locais passaram. Há proteções relevantes no código e nas migrations: isolamento por banda, regras de administrador/membro, restrições de autoria, projeção pública limitada e tratamento cuidadoso de datas e temas.

Ainda não é recomendado publicar este estado do projeto. A versão aprovada não está integralmente registrada no Git, o roteiro de instalação do banco está incompleto e faltam comprovações do artefato de produção e da compatibilidade do banco de destino.

Os BLOQUEADORES abaixo são impedimentos de liberação. Não significam que tenha sido comprovada uma invasão, exposição de registros privados ou falha no banco de produção. O estado remoto não foi inspecionado.

## 3. Estado do Git e separação das alterações

- Branch: `feature/security-record-ownership`.
- HEAD: `d9dcfdd34a3b738d233c20f98730d6b1fff4a418`.
- Último commit: `fix(dates): use Sao Paulo deadlines and preserve event timestamps`.
- Estado registrado: 24 arquivos modificados e 13 arquivos não rastreados, sem alterações preparadas para commit.
- Branch, HEAD e listagem de alterações foram reconfirmados antes de criar este relatório. O relatório acrescenta um novo arquivo não rastreado a esse estado.

### 3.1 Arquivos modificados do aplicativo

1. `src/app/b/[slug]/error.tsx`
2. `src/app/b/[slug]/loading.tsx`
3. `src/app/b/[slug]/not-found.tsx`
4. `src/app/bandas/[bandId]/agenda/page.tsx`
5. `src/app/bandas/[bandId]/links/page.tsx`
6. `src/app/bandas/[bandId]/membros/page.tsx`
7. `src/app/bandas/[bandId]/page.tsx`
8. `src/app/bandas/[bandId]/tarefas/page.tsx`
9. `src/app/bandas/nova/page.tsx`
10. `src/app/dashboard/page.tsx`
11. `src/app/globals.css`
12. `src/app/layout.tsx`
13. `src/app/login/page.tsx`
14. `src/app/page.tsx`
15. `src/components/band-navigation.tsx`
16. `src/components/band-public-profile-settings.tsx`
17. `src/components/linkified-text.tsx`
18. `src/components/public-band-profile.tsx`
19. `tailwind.config.ts`
20. `tests/public-profile.test.cjs`

### 3.2 Arquivos modificados de laboratório ou conteúdo misto

| Arquivo | Classificação | Evidência e tratamento recomendado |
| --- | --- | --- |
| `next.config.ts` | Laboratório | Inclui `192.168.0.6` em `allowedDevOrigins`; revisar a necessidade antes de integrar à versão publicável. |
| `src/lib/public-band-data.ts` | Misto | Contém validação de imagens e exceções HTTP para origens locais em desenvolvimento. Separar os trechos de laboratório das validações do aplicativo. |
| `src/lib/supabase/public-server.ts` | Misto | Contém validações úteis e separação entre endpoint público e interno, com origens específicas do laboratório. Revisar o contrato de configuração para publicação. |
| `tests/public-band-data.test.cjs` | Misto | Reúne regressões do aplicativo e testes das exceções de desenvolvimento. Organizar junto às mudanças correspondentes. |

### 3.3 Arquivos não rastreados necessários ao aplicativo

1. `src/app/b/[slug]/layout.tsx`
2. `src/app/bandas/[bandId]/layout.tsx`
3. `src/app/bandas/[bandId]/perfil-publico/page.tsx`
4. `src/components/band-workspace.tsx`
5. `src/components/card-details.tsx`
6. `src/components/navigation-icon.tsx`
7. `src/components/theme-provider.tsx`
8. `src/components/theme-selector.tsx`
9. `src/lib/theme.ts`
10. `tests/theme.test.cjs`

### 3.4 Arquivos não rastreados de laboratório ou demonstração

| Arquivo | Evidência | Recomendação |
| --- | --- | --- |
| `bandup-postgres-loopback-procedure.py` | Procedimento de manutenção com nomes de contêineres, portas, imagem e caminhos específicos do laboratório. | Não integrar automaticamente ao pacote funcional do frontend; manter separado e sujeito à autorização própria de manutenção. |
| `tests/test_bandup_postgres_loopback_procedure.py` | Testes offline desse procedimento, com arquivos temporários e mocks de subprocessos. | Manter junto ao procedimento, separado dos testes funcionais do aplicativo. Não foi executado nesta auditoria. |
| `public/demo/magijos.svg` | Material demonstrativo dentro da pasta servida publicamente. | Decidir explicitamente se pertence à versão publicada. A localização em `public` implica disponibilidade quando incluído no deploy. |

## 4. Achados BLOQUEADORES

### B01 — A versão aprovada ainda não é reproduzível pelo Git

- **Gravidade:** BLOQUEADOR de liberação.
- **Arquivos afetados:** todos os arquivos modificados do aplicativo e, especialmente, os arquivos essenciais não rastreados listados na seção 3.3.
- **Evidência:** existem 24 arquivos modificados e 13 não rastreados. Provider de temas, layouts, nova página e componentes essenciais permanecem como `??`. O HEAD não representa a versão visual e funcional aprovada.
- **Impacto:** publicar ou transportar apenas parte das alterações pode omitir dependências essenciais. Um checkout do HEAD não reproduz o aplicativo aprovado.
- **Correção recomendada:** revisar e organizar integralmente as alterações do aplicativo, incluindo os novos arquivos e seus testes, separando os artefatos e trechos específicos do laboratório. Só depois produzir uma versão reproduzível.
- **Limite:** nenhum commit ou preparação de arquivos foi executado pela auditoria.

### B02 — Instruções de instalação do banco incompletas

- **Gravidade:** BLOQUEADOR de liberação.
- **Arquivo afetado:** `README.md:29`.
- **Arquivos relacionados:** `supabase/migrations/20261001000000_initial_bandup_schema.sql` e migrations posteriores.
- **Evidência:** o README orienta aplicar somente a migration inicial. O aplicativo atual depende das posteriores para publicação, associação tarefa/evento e proteções de propriedade. As migrations posteriores também restringem exclusões e tornam autoria/banda imutáveis.
- **Impacto:** seguir apenas o README produz um banco incompatível com o aplicativo atual e deixa regras anteriores no lugar das proteções posteriores.
- **Correção recomendada:** documentar a sequência completa e validada das oito migrations, os pré-requisitos, as verificações de compatibilidade e as condições para interromper o procedimento. Não presumir que aplicar apenas a migration inicial seja suficiente.
- **Limite:** não foi verificado o estado instalado em produção e nenhuma migration foi executada.

### B03 — Compatibilidade do banco de destino não comprovada

- **Gravidade:** BLOQUEADOR de liberação por evidência insuficiente.
- **Arquivos afetados:** `supabase/tests/public_band_profiles.md:202` e `supabase/migrations/20261020000000_public_band_profiles.sql:152`.
- **Evidência:** a documentação registra pendências de upgrade com dados, colisões, concorrência, sessões independentes e cache. A migration pública cria um papel e transfere propriedade de view, exigindo permissões e condições específicas.
- **Impacto:** não é possível garantir que o banco de destino aceite a instalação ou possua os mesmos objetos, políticas, grants e proteções do laboratório.
- **Correção recomendada:** validar primeiro em ambiente descartável completo. Posteriormente, com autorização específica, comparar migrations instaladas, objetos existentes, proprietários, RLS, grants e permissões de criação de papel no destino. Tratar colisões por revisão, sem substituir ou remover objetos automaticamente.
- **Limite:** não é uma vulnerabilidade confirmada em produção; o estado remoto não foi inspecionado.

### B04 — Artefato de produção ainda não validado

- **Gravidade:** BLOQUEADOR de liberação.
- **Arquivos envolvidos:** `package.json`, `src/app/layout.tsx`, `src/lib/theme.ts`, rotas e componentes públicos.
- **Evidência:** os testes transpõem módulos em memória. Não comprovam bundle minificado, hidratação, inicialização do tema e renderização pública no modo de produção. O build não foi executado na auditoria somente de leitura.
- **Impacto:** o sucesso no servidor de desenvolvimento e nos testes unitários não demonstra que o artefato publicado terá o mesmo comportamento.
- **Correção recomendada:** autorizar posteriormente o build e testar seu artefato em ambiente isolado, incluindo inicialização antes da hidratação, persistência de aparência, leitura pública, páginas de erro e funcionamento no Safari iOS 15.

## 5. Achados IMPORTANTES

### I01 — Validação inconsistente de URLs e risco de publicação de credenciais

- **Gravidade:** IMPORTANTE.
- **Arquivos afetados:** `src/app/bandas/[bandId]/links/page.tsx:30`, `src/lib/social-links.ts:20` e `supabase/migrations/20261020000000_public_band_profiles.sql:185`.
- **Evidência:** `isValidHttpUrl` verifica apenas os protocolos HTTP/HTTPS. `getSafeExternalUrl` rejeita credenciais e caracteres de controle. A view pública retorna a URL armazenada sem a mesma sanitização.
- **Reprodução registrada:** uma URL sintética com usuário/senha foi aceita pela validação de Links e rejeitada pela projeção pública do aplicativo. A reprodução foi local e sem rede.
- **Impacto:** um link pode ser marcado como publicado e omitido no HTML. Uma URL explicitamente publicada contendo credenciais pode continuar acessível pela API da view.
- **Correção recomendada:** reutilizar a validação segura na gravação e revisar o tratamento de valores inseguros já armazenados. Definir também como impedir exposição desses valores pela superfície pública, sem presumir que a filtragem do HTML proteja a API.
- **Limite:** não foi constatada a presença de credenciais reais em registros; a evidência usou dados sintéticos.

### I02 — Páginas internas não acompanham logout em outra aba

- **Gravidade:** IMPORTANTE.
- **Arquivos afetados:** `src/app/dashboard/page.tsx:47`, `src/components/band-workspace.tsx:18` e demais páginas internas. Referência de comparação: `src/app/login/page.tsx:33`.
- **Evidência:** o único `onAuthStateChange` encontrado está no login. O dashboard carrega os dados uma vez; o layout compartilhado não limpa os dados em resposta à saída de sessão.
- **Impacto:** outra aba pode continuar mostrando informações anteriormente carregadas após logout, especialmente relevante em dispositivos compartilhados.
- **Correção recomendada:** acompanhar alterações de sessão, limpar os dados carregados e encaminhar o usuário ao login. Incluir testes de logout entre abas, expiração e revogação de acesso.
- **Limite:** não foi comprovado novo acesso sem autorização. Novas operações continuam sujeitas ao Supabase e às políticas RLS efetivamente instaladas.

### I03 — Parte das validações funcionais existe somente no cliente

- **Gravidade:** IMPORTANTE.
- **Arquivos afetados:** `supabase/migrations/20261001000000_initial_bandup_schema.sql:35`, `src/lib/date-time.ts:74` e formulários de bandas, tarefas, eventos e links.
- **Evidência:** títulos são `NOT NULL`, mas podem ser vazios; os limites de tamanho dos formulários não estão refletidos nas constraints examinadas. A regra de início futuro de eventos está no cliente, sem equivalente nas constraints examinadas.
- **Impacto:** clientes autenticados que chamem a API diretamente podem contornar essas validações. Trata-se de integridade de dados, distinta das permissões de acesso.
- **Correção recomendada:** definir quais invariantes devem ser obrigatórias e validá-las também na camada confiável, acompanhadas de testes com chamadas diretas à API. Qualquer mudança de banco deve ser proposta e autorizada separadamente.

### I04 — Versão de Node não explicitada no aplicativo

- **Gravidade:** IMPORTANTE.
- **Arquivos afetados:** `package-lock.json:1133` e `package.json`.
- **Evidência:** o lockfile fixa `@supabase/supabase-js` em `2.117.2`, com requisito Node `>=22`. O projeto não declara `engines`. O ambiente local auditado usa Node `22.18.0`.
- **Impacto:** não é seguro presumir que desenvolvimento, build e execução na Vercel utilizem versões compatíveis e equivalentes.
- **Correção recomendada:** explicitar uma versão compatível e alinhar os ambientes de desenvolvimento, build e hospedagem. Manter a instalação reproduzível pelo lockfile.
- **Limite:** a configuração da Vercel não foi acessada; não foi comprovado que ela esteja usando uma versão incompatível.

### I05 — Contraste insuficiente em textos pequenos do modo Claro

- **Gravidade:** IMPORTANTE.
- **Arquivos afetados:** `src/app/globals.css`, `src/app/login/page.tsx:203` e `src/components/band-workspace.tsx:37`.
- **Evidência:** o token `content-faint`, RGB `161 161 170`, apresenta contraste aproximado de **2,56:1** sobre branco. É usado no rodapé do login e no título Workspace da sidebar.
- **Impacto:** fica abaixo de 4,5:1 para texto normal, prejudicando a leitura de textos pequenos no modo Claro.
- **Correção recomendada:** revisar o token ou seus usos informativos, conciliando acessibilidade com a identidade visual aprovada. Não alterar a paleta sem revisão visual.
- **Limite:** a paleta não foi modificada pela auditoria.

### I06 — Configurações do laboratório precisam de revisão antes da publicação

- **Gravidade:** IMPORTANTE.
- **Arquivos afetados:** `next.config.ts`, `src/lib/public-band-data.ts:34`, `src/lib/supabase/public-server.ts:13`, `tests/public-band-data.test.cjs` e `src/lib/supabase/client.ts:10`.
- **Evidência:** existem referências explícitas aos endpoints locais e suporte a `SUPABASE_INTERNAL_URL`. As exceções HTTP estão restritas a desenvolvimento, o que é positivo. Porém, transportar as variáveis locais para publicação causaria falhas. O cliente do navegador verifica apenas a presença das variáveis; não rejeita uma chave privilegiada configurada incorretamente. O cliente público do servidor possui essa proteção.
- **Impacto:** configuração equivocada pode quebrar a leitura pública ou expor uma chave privilegiada ao incorporá-la em `NEXT_PUBLIC_*`.
- **Correção recomendada:** revisar os trechos específicos do laboratório e validar URL e chave pública do mesmo projeto no ambiente de publicação. Verificar a necessidade de `SUPABASE_INTERNAL_URL` no ambiente publicado. Nunca disponibilizar chave privilegiada em variáveis públicas de build.
- **Limite:** não foi constatada chave privilegiada efetivamente publicada nem foram consultadas as credenciais de produção.

## 6. MELHORIAS FUTURAS

### F01 — Redução gradual de código duplicado

- **Gravidade:** MELHORIA FUTURA.
- **Arquivos envolvidos:** páginas internas em `src/app/bandas/[bandId]/`, especialmente `tarefas/page.tsx`, `agenda/page.tsx`, `membros/page.tsx`, `links/page.tsx` e `perfil-publico/page.tsx`.
- **Evidência:** há repetição de carregamento, verificação de sessão/vínculo, controles de montagem e apresentação de estados de erro e indisponibilidade.
- **Impacto:** aumenta o esforço para manter o comportamento consistente e facilita divergências futuras entre telas.
- **Correção recomendada:** reduzir a repetição gradualmente, quando houver demanda de manutenção, preservando as verificações existentes e os testes. Não fazer uma refatoração ampla apenas para publicação.

### F02 — Explicitar o fuso dos horários de eventos

- **Gravidade:** MELHORIA FUTURA.
- **Arquivos envolvidos:** `src/lib/date-time.ts:46`, `src/app/bandas/[bandId]/agenda/page.tsx` e `src/app/bandas/[bandId]/page.tsx`.
- **Evidência:** eventos são convertidos e exibidos no fuso do dispositivo. Isso difere da regra explicitamente fixa de São Paulo aplicada aos prazos das tarefas.
- **Impacto:** pessoas em fusos distintos podem interpretar de forma diferente os horários exibidos se essa convenção não estiver clara.
- **Correção recomendada:** informar na interface ou documentação que os horários de eventos seguem o fuso do dispositivo, sem alterar a regra de datas nesta etapa.
- **Limite:** não foi encontrada uma regressão demonstrável na conversão dos horários.

### F03 — Observabilidade com preservação de privacidade

- **Gravidade:** MELHORIA FUTURA.
- **Arquivos envolvidos:** `src/lib/supabase/public-server.ts:70` e tratamentos de erro das páginas internas.
- **Evidência:** os erros públicos são apresentados de forma genérica e detalhes de backend são descartados. Isso reduz exposição, mas limita o diagnóstico operacional quando ocorrer uma falha real.
- **Impacto:** investigação de erros em um ambiente publicado pode ser mais difícil.
- **Correção recomendada:** adicionar observabilidade controlada, preservando mensagens públicas genéricas e evitando registrar tokens, credenciais ou conteúdo privado.
- **Limite:** não foi diagnosticada falha em um serviço de monitoramento existente; o achado é uma recomendação de evolução operacional.

### F04 — Automatizar verificações em CI

- **Gravidade:** MELHORIA FUTURA.
- **Arquivos envolvidos:** `package.json` e configuração futura de CI.
- **Evidência:** não há script `test` no `package.json` nem pipeline versionado identificado na auditoria. As verificações atuais dependem de execução manual.
- **Impacto:** regressões podem chegar a uma versão futura sem passar pela mesma matriz de validação.
- **Correção recomendada:** automatizar testes, TypeScript, ESLint e checks de produção em CI, mantendo integrações com banco restritas a ambientes próprios de teste e sem credenciais de produção.

## 7. Pontos positivos confirmados no código

- RLS separa acesso por banda; migrations posteriores restringem exclusão de tarefas/eventos a administradores.
- Tarefas possuem vínculo composto para responsável da mesma banda; a associação tarefa/evento também é composta.
- Há proteções de imutabilidade de autoria/banda de tarefas e eventos e de transferência de vínculos/links.
- Operações relevantes revalidam permissões; atualização ou exclusão sem linha retornada não é tratada como sucesso.
- O Perfil Público consulta uma view de projeção explícita, sem tarefas, membros ou identificadores internos.
- O papel proprietário da view pública é restrito e está sujeito às políticas descritas na migration.
- A leitura pública usa cliente sem sessão persistente, timeout e política sem cache persistente.
- Temas usam a preferência do visitante, persistência, acompanhamento do sistema e tratamento de indisponibilidade do armazenamento.
- A implementação evita funções modernas de cor incompatíveis com Safari 15.

Não foi identificado um caminho comprovado de acesso entre bandas no código examinado. Essa conclusão depende de as migrations e permissões correspondentes estarem efetivamente instaladas no destino. A ausência de uma falha identificada nesta revisão não equivale a certificação de segurança.

## 8. Datas e funcionalidades

Não foi encontrada regressão demonstrável nas regras de datas:

- Prazos de tarefas seguem `America/Sao_Paulo`.
- Novos prazos usam a convenção explícita de meio-dia UTC para a coluna `timestamptz` existente.
- Eventos são exibidos e editados no fuso do dispositivo.
- Campos de data/hora não alterados são omitidos do update.
- A Agenda relê os horários atuais antes da validação final.
- Os testes cobrem virada de dia, fusos diferentes, horário de verão e preservação de segundos e frações.

Os testes exercitam criação de bandas, formulários, permissões de tarefas/eventos, edição de links, publicação, compartilhamento e temas. Contudo, a criação efetiva do administrador pelo trigger e a persistência real dessas operações precisam de comprovação por integração com o backend.

## 9. Cobertura existente e limites

### Cobertura executada

- `tests/date-time.test.cjs`: prazos, fusos, horários originais, edição e retomada da página.
- `tests/form-validation.test.cjs`: campos obrigatórios, criação de bandas, geração de slug, regras de acesso, criação/edição/exclusão, perda de permissão e preservação de datas.
- `tests/public-band-data.test.cjs`: projeção pública, validação de imagens/URLs, configuração, transporte simulado e erros genéricos.
- `tests/public-profile.test.cjs`: renderização, fallback de imagem, links, cópia/compartilhamento e controles de publicação.
- `tests/theme.test.cjs`: preferências, persistência, Automático, retomada, compatibilidade de listeners, renderização, tokens/contraste, navegação, cards, nova aba e formulário de links.

Os testes usam mocks de transporte e simulação de hooks. Alguns validam estruturas e classes, mas não executam layout real de navegador. Não comprovam, por si só, RLS instalado, autenticação HTTP real, foco/rolagem no Safari, publicação observada por outro cliente ou cache de hospedagem.

### Cobertura SQL e de laboratório

Existem `supabase/tests/record_ownership_guards.sql` e `supabase/tests/public_band_profiles.sql`, com documentação de validações locais anteriores. Essas suítes não foram executadas nesta auditoria. A documentação registra um laboratório mínimo que não reproduz integralmente autenticação, proprietários, ACLs e demais características do destino.

A última migration de imutabilidade de tarefas deve ter testes explícitos na sequência completa; não se deve presumir que as validações documentadas para as sete migrations anteriores comprovem essa etapa adicional.

O teste Python de manutenção do laboratório não integra os 142 testes funcionais executados e não foi executado nesta auditoria.

## 10. Testes adicionais recomendados

1. **Supabase completo e descartável:** usar identidades reais de teste como administrador, autor, responsável, membro comum e usuário de outra banda. Executar tentativas diretas pela API, sem depender dos bloqueios da interface.
2. **Persistência e isolamento:** criar, reler, editar e excluir; testar IDs de outra banda, perda de permissão durante a operação e respostas com zero linhas afetadas.
3. **Banco:** validar a sequência completa das oito migrations, upgrade com dados existentes, colisões e imutabilidade de tarefas após a última migration.
4. **Publicação:** retirar perfil ou link e consultar por uma sessão anônima independente; conferir API, HTML, RSC, metadados e cache. Documentar que páginas já abertas, cópias e imagens públicas não são apagadas retroativamente pela retirada.
5. **Sessão:** testar logout em outra aba, expiração e revogação de acesso enquanto uma página permanece aberta.
6. **URLs:** testar credenciais, caracteres de controle, URLs inválidas e consistência entre gravação, HTML público e API da view.
7. **Build e navegador:** executar o artefato de produção em ambiente isolado; validar Safari iOS 15, teclado/VoiceOver, detalhes expansíveis, ações sem expansão acidental, foco/rolagem do formulário e seletores nativos.
8. **Temas:** validar Claro, Escuro e Automático após recarregar, retomar do segundo plano, alterar a aparência do sistema e quando o armazenamento estiver indisponível.
9. **Acessibilidade:** medir contraste dos textos pequenos e verificar foco, nomes acessíveis e navegação sem mouse.

## 11. Riscos de diferença entre laboratório e publicação

- O banco local isolado não comprova o schema, grants e políticas do destino.
- As exceções HTTP do laboratório não valem no modo de produção; URLs e chaves precisam corresponder ao projeto correto.
- As variáveis públicas são incorporadas ao código do navegador; uma chave privilegiada não pode ocupar esse lugar.
- A versão de Node e a instalação das dependências precisam coincidir com os requisitos do lockfile.
- Bundle de produção e hidratação não são equivalentes à transpilaçao em memória usada pelos testes.
- Retirada de publicação precisa ser observada também por sessões independentes e pelas camadas reais de cache.
- Os recursos de cópia/compartilhamento e o comportamento do Safari precisam ser conferidos no ambiente HTTPS final de teste, sem presumir equivalência com acesso local HTTP.
- Não foi feita uma verificação atualizada de vulnerabilidades das dependências. Não há, neste relatório, afirmação de ausência ou presença de CVEs nas versões instaladas.

## 12. Proposta de organização dos commits locais

Esta seção é somente uma proposta. Nenhum commit, preparação de arquivos ou comando de integração foi executado.

1. **Infraestrutura dos temas:** tokens, provider, inicializador, seletor, layout raiz e testes correspondentes.
2. **Adaptação visual das telas:** páginas, estados públicos e componentes compartilhados, com os testes relacionados.
3. **Navegação e organização:** layout persistente, ícones, aba Perfil Público, gestão de links e cards expansíveis, acompanhados dos testes.
4. **Laboratório separado:** manutenção, demonstração e configurações locais. Revisar os arquivos mistos por trechos; não incluí-los automaticamente no pacote de publicação.

Cada commit futuro deve funcionar com seus próprios arquivos novos e testes. Não organizar a versão apenas pelos arquivos já rastreados. Caso seja necessário dividir testes entre etapas, essa divisão deve ser planejada na revisão dos commits, sem deixar dependências faltantes entre eles.

## 13. Checklist de preparação para publicação

- [ ] Resolver ou deliberar explicitamente sobre os achados classificados para esta versão.
- [ ] Registrar integralmente a versão aprovada e separar os artefatos do laboratório.
- [ ] Atualizar o roteiro de instalação e implantação do banco.
- [ ] Confirmar Node compatível e instalação reproduzível pelo lockfile.
- [ ] Verificar avisos de segurança atuais das dependências.
- [ ] Autorizar e validar build e execução em modo de produção.
- [ ] Executar integração e regressão SQL em ambiente descartável aprovado.
- [ ] Validar URLs e chaves do ambiente de publicação, sem transportar a configuração do laboratório.
- [ ] Com autorização específica futura, comparar schema, RLS, grants, objetos e migrations do destino.
- [ ] Executar a matriz final funcional, de datas, temas, isolamento e acessibilidade.
- [ ] Revisar o plano de recuperação antes de qualquer publicação ou alteração no banco.

## 14. Conclusão e autorização

O projeto apresenta boa base funcional e verificações locais aprovadas. Não há evidência suficiente para recomendar sua publicação imediata, principalmente por rastreabilidade do artefato, instalação do banco e validação do modo de produção.

Nenhuma correção foi aplicada durante a auditoria. A criação deste documento não altera esse diagnóstico nem autoriza mudanças em código, testes, configuração, banco, infraestrutura ou produção. Qualquer próxima modificação depende de autorização do usuário.
