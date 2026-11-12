# Interface de exclusão de bandas

Implementação local; nenhuma chamada ao Demo é necessária para os testes.

- A ação fica em **Configurações da banda** (`/bandas/[bandId]/perfil-publico`), independentemente da publicação do perfil. Somente administradores verificados recebem o formulário. Outros administradores não impedem a exclusão; a RPC continua sendo a autoridade de autorização.
- O nome deve coincidir exatamente, inclusive espaços, letras e acentos. O aviso inclui integrantes (vínculos, sem excluir contas pessoais), tarefas, agenda e dados relacionados. A limpeza de logos é separada e pode ficar pendente enquanto o worker não estiver ativo.
- Antes da chamada de exclusão, uma transação IndexedDB com durabilidade estrita confirma o registro `{version, actorId, bandId, operationId, confirmation}`. O ID vem de `crypto.randomUUID()`. Transações entre abas reutilizam o mesmo registro, sem substituir nome/ID. Falhas de armazenamento bloqueiam o envio. Não há tokens nem chaves privilegiadas nesse registro.
- O cliente usa a sessão existente, com token capturado e verificação da conta conforme a infraestrutura de logos. Troca de conta, logout e desmontagem abortam a interface antiga. O servidor faz a validação final de administrador, nome e idempotência atomicamente.
- Falha, timeout, resposta inválida ou perdida provocam consulta de recibo; nunca uma segunda exclusão automática. A operação tem prazo de 25 segundos, seguido, quando necessário, por uma recuperação adicional limitada a 10 segundos. Os limites incluem esperas por sessão e armazenamento; a limpeza local após sucesso tem limite de 8 segundos. O usuário pode consultar novamente ou repetir explicitamente a mesma operação, digitando o nome original. Envios simultâneos na mesma tela ficam bloqueados. Uma aba antiga que perdeu o registro porque outra aba concluiu a operação consulta o ID original, sem gerar outro ID.
- **NULL nunca significa falha da exclusão nem existência da banda.** Sem recibo válido, o estado permanece inconclusivo e o registro é preservado, inclusive depois dos 90 dias. Não há inferência pelo desaparecimento da banda ou do vínculo.
- O painel pessoal tem recuperação **somente de leitura** dos registros da conta e projeto atuais. Isso permite reconciliar a resposta perdida depois que o controle de acesso redireciona quem já não pertence à banda. A recuperação não exige vínculo atual.
- Sucesso exige resposta/recibo com `status=deleted`, o ID esperado e estado de limpeza reconhecido. Depois disso, o registro local é removido por comparação do ID; a navegação é atualizada e recarregada em `/dashboard`. Se a limpeza local falhar, a tela mantém a exclusão confirmada e permite concluir, sem reenviar a exclusão.

## Limites e validação

O registro permanece apenas no navegador/perfil de origem até a confirmação; limpar os dados do navegador, usar outro dispositivo ou navegação privada pode eliminar a recuperação local. Após 90 dias não há garantia de recibo recuperável. Os tombstones e IDs consumidos continuam protegidos pelo banco. Um nome alterado em outra aba não substitui a confirmação salva nem cria nova operação; a tentativa original permanece preservada e pode exigir resolução manual. Não há reset automático de tentativas inconclusivas.

As migrations aplicadas e os contratos das RPCs não são modificados. O frontend não executa DELETE de tabelas, não acessa a fila privada nem chama Storage. A ativação do Cron de recibos e do worker de logos continua separada.

Testes locais, com rede bloqueada:

```powershell
node --require ./tests/deny-network.cjs --test tests/band-deletion.test.cjs tests/band-deletion-attempts.test.cjs
npm run lint
npx tsc --noEmit --incremental false
```

Antes de publicar, validar visualmente em ambiente isolado os estados móvel/desktop, teclado, cancelamento e recuperação após recarga. Nenhuma exclusão real no Demo faz parte desta implementação.

Validação local: 38 testes novos aprovados; suíte completa com 590 aprovados, 5 falhas preexistentes e 1 teste PostgreSQL opt-in ignorado (596 no total). As falhas ficam em `band-photo-ui.test.cjs` (1), `onboarding-flow.test.cjs` (2) e `theme.test.cjs` (2). As mesmas cinco falhas foram reproduzidas removendo as integrações desta tarefa somente em memória, sem alterar arquivos. Lint, TypeScript e build isolado passaram; o build usou rede bloqueada, configuração pública fictícia e fonte já disponível localmente. O `.next` do projeto foi preservado. Nenhuma migration foi alterada ou executada.

Arquivos desta implementação:

- `src/app/bandas/[bandId]/perfil-publico/page.tsx`
- `src/app/dashboard/page.tsx` (somente integração da recuperação; alterações anteriores preservadas)
- `src/components/band-deletion-panel.tsx`
- `src/lib/band-deletion.ts`
- `src/lib/band-deletion-attempts.ts`
- `tests/band-deletion.test.cjs`
- `tests/band-deletion-attempts.test.cjs`
- `docs/band-delete-ui.md`
