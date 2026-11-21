# Validação visual isolada, sem Supabase

Os mocks de hooks existentes permitem testes automatizados, mas não uma sessão interativa no navegador.
O visualizador reutiliza o componente de descoberta, o avatar de iniciais e o CSS/Tailwind reais.
Os imports do serviço são substituídos somente no bundle isolado de testes.
Nenhum arquivo de src, autenticação, flag real ou configuração Next é alterado.

Na raiz do repositório, execute:

```powershell
node scripts/preview-musician-discovery.cjs
```

Abra **http://127.0.0.1:4317/**. Encerre com Ctrl+C. Não precisa iniciar next dev,
configurar .env, autenticar ou habilitar NEXT_PUBLIC_BANDUP_MUSICIAN_DISCOVERY_ENABLED.
O script não lê .env e não carrega o cliente Supabase. Não há API de mocks.
A prévia é uma bancada de componentes fora do aplicativo: não substitui a validação da autenticação,
da navegação ou da RPC real. A rota /descobrir/musicos do app continua protegida e desligada.

- Lista: 47 registros fictícios, disponíveis e indisponíveis; páginas de 20/20/7.
- Busque Ana, limpe o campo e procure um nome inexistente. A busca usa fixtures locais.
- Percorra Próxima/Anterior; confirme que uma nova busca volta à primeira página.
- Selecione carregamento lento, vazio e erro; no erro, confira Tentar novamente.
  Para simular recuperação, volte ao cenário de lista. Para concorrência, use o cenário lento e digite rapidamente.
- Alterne o tema; confira larguras de 375 px e 1280 px, nomes longos, iniciais e navegação por Tab.

O servidor aceita somente GET de três recursos estáticos e escuta apenas em 127.0.0.1.
CSP bloqueia conexões, imagens externas e frames. O bundle é conferido para excluir os serviços reais.
NODE_ENV=production recusa a execução; fixtures ficam em tests/visual, sem imports em src.
Os arquivos gerados ficam no diretório ignorado .next/musician-visual e não fazem parte das rotas Next.
Não publique nem transporte esse diretório como artefato da aplicação.

Verificação sem servidor persistente:

```powershell
node scripts/preview-musician-discovery.cjs --check
node --test tests/musician-visual-preview.test.cjs tests/musician-discovery-ui.test.cjs
```
