# Descobrir músicos

Rota: `/descobrir/musicos`, acessível pela descoberta de bandas quando habilitada.
Usa a proteção de sessão existente e somente a RPC `bandup_discover_musicians`.
Lista usuários disponíveis e indisponíveis, com busca por nome no servidor e páginas de 20.
Uma linha extra determina se há próxima página; não há contagem total nem identificadores públicos.
A busca reinicia na primeira página; novas consultas abortam e invalidam respostas anteriores.
Como `photo_ref` é nulo por privacidade, o avatar usa apenas iniciais. URLs recebidas são ignoradas.

`NEXT_PUBLIC_BANDUP_MUSICIAN_DISCOVERY_ENABLED` fica desligada por padrão (ausente ou `false`).
Nesse estado a rota retorna 404, o link não aparece e o serviço recusa chamadas antes da RPC.
Para testar, configurar `true` apenas em ambiente local apontado ao PostgreSQL/Supabase local
com as migrations já aplicadas e reiniciar/recompilar a aplicação.
Não habilitar no Demo antes de aprovação e aplicação separada das migrations no destino.
Nenhuma migration, RLS ou permissão é modificada pela interface.

Verificação automatizada: `node --test tests/musician-discovery-ui.test.cjs tests/private-session.test.cjs`;
`npx tsc --noEmit`. Os testes usam respostas simuladas, sem acesso a ambientes remotos.
Validação visual manual pendente: celular e desktop, nomes longos/duplicados, navegação por teclado,
busca vazia, erro, anterior/próxima e logout durante uma consulta.
