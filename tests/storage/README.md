# Storage real: execução manual opt-in

Não executado remotamente durante a preparação. Não é descoberto por `node --test tests/*.test.cjs`.
O executor usa REST diretamente, sem service_role, SDK persistente, alteração de avatar_url, migrations ou limpeza automática.

## Preparação

Confirmar no painel o projeto `zwmihhdvvpqgyavworgh`, bucket público `avatars`, limite 2097152 bytes, MIME JPEG/PNG/WebP, todas as policies efetivas (inclusive ALL), RLS e ausência de permissões concorrentes de UPDATE/DELETE. Autenticação anônima e confirmação de e-mail devem permanecer desabilitadas conforme contexto confirmado. Nenhuma configuração é alterada pelo executor.

Node 20+; executar do repositório. Configurar dois e-mails explícitos exclusivos de teste, sob seu controle, nas variáveis abaixo. Não são gerados nem fixados no código. São removidos espaços nas extremidades e normalizadas letras para minúsculas, preservando aliases com `+`. Ambos devem ser válidos, não vazios e distintos após normalização. Senhas aleatórias e sessões ficam apenas em memória; não são recuperáveis pelo manifesto.

Antes de executar, confirmar que os e-mails não estão cadastrados. O executor tenta cadastrar os endereços; não faz login em contas existentes nem recuperação de senha. Para repetir, revisar o resultado anterior e usar novos endereços descartáveis ou aguardar limpeza autorizada. Não há retomada automática.

Fornecer no ambiente do processo, por mecanismo local seguro, sem colar segredos no terminal gravado/chat:

- `BANDUP_STORAGE_CONFIRM=zwmihhdvvpqgyavworgh`
- `BANDUP_STORAGE_URL=https://zwmihhdvvpqgyavworgh.supabase.co` (exatamente)
- `BANDUP_STORAGE_PUBLIC_KEY`: chave publishable ou JWT anon desse projeto; secret/service_role são rejeitados.
- `BANDUP_STORAGE_TEST_EMAIL_A`: e-mail descartável da conta A.
- `BANDUP_STORAGE_TEST_EMAIL_B`: e-mail descartável da conta B.

A variável antiga `BANDUP_STORAGE_TEST_EMAIL_DOMAIN` não é mais usada. Configurar os dois aliases autorizados somente no ambiente local. Não há fallback para geração de e-mails.

Não lê `.env` automaticamente e não aceita URL alternativa. Chaves publishable não codificam o projeto; conferir manualmente sua origem. Não usar tracing de HTTP, dump de ambiente, HAR ou depurador que grave credenciais.

Após autorização para **executar**, comando único:

```powershell
node tests/storage/run-avatars.cjs --execute
```

Sem opt-in completo o processo termina antes de rede. O manifesto `bandup-storage-run-<UUID>.json` é criado no diretório atual com exclusividade antes de conectar. Contém somente projeto, e-mails/IDs descartáveis, caminhos e resultados; não contém senhas/tokens. Guardar privadamente, fora do commit. Não há retries automáticos; timeout/erro ambíguo exige inspeção manual. Evitar execuções paralelas.

## Matriz e critérios

Contas A/B têm uploads próprios de controle com PNG sintético. Para cada tentativa proibida, o proprietário lista o nome exato e, se presente, baixa via rota autenticada para SHA-256 antes e depois. Caminhos são UUIDs novos registrados antes da escrita. Nenhum caminho pré-existente é usado; se detectado, interrompe.

Casos: upload cruzado A→B, sem sessão, MIME text/plain em extensão png, payload 2097153 bytes, UPDATE de objeto próprio e DELETE de objeto próprio. Todos devem preservar existência/conteúdo. Respostas 5xx, falhas de transporte ou sucesso inesperado interrompem. DELETE pode retornar sucesso com lista vazia; só passa se o objeto continuar íntegro. O teste de tamanho usa PNG acrescido de padding; não testa validade visual nem sniffing completo de conteúdo. Não inclui teste da fronteira exata de 2097152, upsert ou fluxo de cadastro/UI.

Bucket público permite download público; esse acesso não deve ser interpretado como falha de RLS. “Sem sessão” aqui significa sem Bearer, com a chave pública exigida pela API. Confirmação e configuração efetiva das policies são preflight manual; não são inferidas apenas dos códigos HTTP.

Se qualquer escrita proibida ocorrer, parar e revisar o manifesto. O executor já para na primeira falha e não tenta corrigir políticas. Uma falha na criação de conta pode deixar a conta criada mesmo sem ID retornado; o e-mail foi registrado antes da chamada.

## Limpeza posterior — autorização separada

Não excluir automaticamente. Após autorização, operador pelo painel Storage deve conferir projeto/bucket e remover **somente** caminhos exatos do manifesto (incluindo tentativas negativas que possam ter criado objetos). Não remover pastas inteiras, bucket ou registros por SQL; não conceder DELETE ao usuário de teste para limpar. Depois remover apenas as duas contas descartáveis, conferindo e-mail/ID. A remoção de conta não substitui a limpeza dos objetos. Guardar resultado sanitizado; remover manifesto local somente quando autorizado/concluído. Nenhuma credencial administrativa é necessária no executor.

## Validação exclusivamente local

```powershell
node --check tests/storage/run-avatars.cjs
node --require ./tests/deny-network.cjs --test tests/storage-runner.test.cjs
```

Os testes locais usam transporte simulado, bloqueiam rede e verificam opt-in, destino, rejeição de chave privilegiada, manifesto antes de rede/escrita, matriz e interrupção quando permissões indevidas são simuladas.
