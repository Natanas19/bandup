# Descoberta de músicos — candidato local

Nenhuma aplicação remota autorizada. Migration aditiva `20261115120000_musician_discovery.sql`; a migration de disponibilidade permanece intacta. Não usar db push/repair.

Contrato: `bandup_discover_musicians(p_query text = '', p_offset integer = 0, p_limit integer = 20)` retorna somente `display_name`, `photo_ref` (sempre NULL), `available`. Consulta vazia inclui todos os registros de auth.users, sem dependência de banda, preenchimento de perfil ou disponibilidade. Inclui o próprio usuário. Nome inválido vira “Músico”; nunca substituir por e-mail. Busca substring literal, sem distinção de caixa, sensível a acentos, aplicada ao nome já validado; limite de 100 caracteres. Metadados são apresentação, nunca autorização.

Disponibilidade é lida por LEFT JOIN; ausência = false. SECURITY DEFINER com dono postgres e caminho fixo, gate de role/identidade/conta existente e ACL exclusiva para authenticated. Não adiciona SELECT direto nem modifica RLS. O bypass do definer é deliberado e limitado à projeção. Exige disponibilidade previamente instalada e revisão do catálogo/ACL do destino antes de aplicação futura.

Paginação por offset não revela UUID Auth: ordem interna por PK, 1–50 linhas, próxima página com offset anterior + quantidade recebida; página cheia pode exigir uma consulta vazia final. Sem total público, identificador de usuário ou token de convite. Determinismo vale para dados estáveis; exclusões/cadastros entre páginas podem deslocar resultados. Busca textual e offsets profundos podem varrer Auth: medir plano/latência em base local representativa antes de liberar; índices/projeção e cursor opaco ficam para uma evolução orientada por medidas. Limite de linhas não limita custo de varredura. Aplicar timeout/rate limit na camada de acesso antes de liberar em escala.

Foto bloqueada: URLs atuais de avatars contêm UUID Auth. Não retornar URL, caminho, hash do UUID nem URL assinada que preserve esse caminho. `photo_ref = NULL` exige fallback de iniciais/avatar local. Entrega futura depende de referência opaca e mecanismo autenticado revisado, sem redirect para a URL original. Nenhum proxy foi criado.

Convites fora do escopo. Um selo available não é autorização; implementação futura exige ator autorizado, disponibilidade revalidada atomicamente e aceitação explícita. Não usar nome como identidade.

Verificação sem banco: `node --test tests/musician-discovery-migration.test.cjs`. São testes estruturais, não prova funcional de PostgreSQL/RLS.
Fixture funcional preparada em `tests/postgres/musician-discovery-checks.sql`: somente banco descartável já pronto `bandup_migration_test`, localhost:5433, postgres; candidatos instalados previamente. Executar manualmente com `psql -X -v ON_ERROR_STOP=1` no destino fixo, sem copiar credenciais para logs. Gate local, dados sintéticos e ROLLBACK; não executar em base compartilhada com dados reais. A fixture não instala migrations nem inicia serviços.
