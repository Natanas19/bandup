-- CANDIDATA LOCAL: NAO APLICADA. Fora de supabase/migrations intencionalmente.
-- Ler band-members-write-hardening.md antes de promover para migration.
-- Aplicacao futura pontual e autorizada; nao usar db push com historico divergente.
-- ACL confirmada no Demo: INSERT/UPDATE apenas authenticated e postgres,
-- sem grant option; nenhum grant por coluna/PUBLIC. Nao repetir coleta.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog;
LOCK TABLE public.band_members IN ACCESS EXCLUSIVE MODE;

DO $proposal$
DECLARE
  target CONSTANT regclass := 'public.band_members'::regclass;
  f record;
  checked_record record;
  before_access jsonb;
  after_access jsonb;
BEGIN
  IF NOT EXISTS (SELECT FROM pg_class WHERE oid=target AND relkind='r'
      AND relrowsecurity AND NOT relforcerowsecurity) THEN
    RAISE EXCEPTION 'Esperada tabela comum com RLS habilitada e sem FORCE RLS';
  END IF;
  IF EXISTS (SELECT FROM pg_inherits WHERE inhrelid=target OR inhparent=target) THEN
    RAISE EXCEPTION 'Heranca/particionamento de tabela exige revisao separada';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper)
     AND current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=target)) THEN
    RAISE EXCEPTION 'Executor deve ser owner da tabela ou superuser';
  END IF;
  -- Ausencia de papel deve produzir diagnostico explicito, antes das consultas
  -- de privilegios que tambem falhariam, sem chegar ao REVOKE.
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated')
     OR NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN
    RAISE EXCEPTION 'Papel cliente obrigatorio ausente: authenticated ou anon';
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('authenticated','anon')
      AND (rolsuper OR rolbypassrls OR rolcreaterole)) THEN
    RAISE EXCEPTION 'Papel cliente privilegiado exige revisao separada';
  END IF;
  -- MEMBER e conservador: abrange memberships mesmo quando NOINHERIT/SET
  -- options impedem hoje o acesso. Nao alterar memberships automaticamente.
  IF EXISTS (SELECT FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner
      WHERE c.oid=target AND (r.rolname IN ('authenticated','anon')
      OR pg_has_role('authenticated',r.oid,'MEMBER')
      OR pg_has_role('anon',r.oid,'MEMBER'))) THEN
    RAISE EXCEPTION 'Cliente alcanca owner da tabela';
  END IF;
  IF NOT has_table_privilege('authenticated',target,'SELECT')
     OR NOT has_table_privilege('authenticated',target,'DELETE') THEN
    RAISE EXCEPTION 'SELECT/DELETE esperados ausentes';
  END IF;
  -- Guardas contra divergencia na futura aplicacao; nao sao uma nova coleta.
  -- Se surgirem grants adicionais, abortar em vez de ampliar os REVOKEs.
  IF (SELECT count(*) FROM pg_class c
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid=target AND a.privilege_type IN ('INSERT','UPDATE')) <> 4
     OR EXISTS (SELECT FROM pg_class c
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid=target AND a.privilege_type IN ('INSERT','UPDATE')
      AND (a.grantee NOT IN (SELECT oid FROM pg_roles
        WHERE rolname IN ('authenticated','postgres')) OR a.is_grantable))
     -- Contagem isolada nao distingue combinacoes ausentes de grants duplicados.
     -- Exigir cada par; count=4 e a guarda acima excluem pares extras/duplicados.
     OR EXISTS (SELECT FROM (VALUES
        ('authenticated','INSERT'),('authenticated','UPDATE'),
        ('postgres','INSERT'),('postgres','UPDATE')
      ) AS expected(role_name,privilege_name)
      WHERE NOT EXISTS (SELECT FROM pg_class c
        CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
        JOIN pg_roles acl_role ON acl_role.oid=a.grantee
        WHERE c.oid=target AND acl_role.rolname=expected.role_name
          AND a.privilege_type=expected.privilege_name))
     OR EXISTS (SELECT FROM pg_attribute att
      CROSS JOIN LATERAL aclexplode(att.attacl) a
      WHERE att.attrelid=target AND att.attnum>0 AND NOT att.attisdropped
      AND a.privilege_type IN ('INSERT','UPDATE')) THEN
    RAISE EXCEPTION 'ACL diverge da evidencia Demo: revisar proposta, nao ampliar revogacoes';
  END IF;
  IF NOT has_table_privilege('postgres',target,'INSERT')
     OR NOT has_table_privilege('postgres',target,'UPDATE') THEN
    RAISE EXCEPTION 'Escrita de postgres esperada ausente';
  END IF;
  IF EXISTS (SELECT FROM pg_roles r WHERE
      (r.rolname IN ('authenticated','anon')
       OR pg_has_role('authenticated',r.oid,'MEMBER')
       OR pg_has_role('anon',r.oid,'MEMBER'))
      AND (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole)) THEN
    RAISE EXCEPTION 'Membership cliente alcanca papel privilegiado';
  END IF;
  -- Apenas os tres caminhos que precisam manter escrita em band_members.
  -- Sem hashes de corpos ou dependencia de RPCs sem relacao com o REVOKE.
  FOR checked_record IN SELECT * FROM (VALUES
    ('private','add_band_creator_as_admin',ARRAY['INSERT']::text[]),
    ('public','bandup_decide_entry',ARRAY['SELECT','INSERT']::text[]),
    ('public','bandup_leave_band',ARRAY['SELECT','UPDATE','DELETE']::text[])
  ) AS required(schema_name,function_name,needed_privileges)
  LOOP
    IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname=checked_record.schema_name AND p.proname=checked_record.function_name
        AND p.prokind='f') <> 1 THEN
      RAISE EXCEPTION 'Funcao definer ausente/ambigua: %.%',checked_record.schema_name,checked_record.function_name;
    END IF;
    SELECT p.* INTO STRICT f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=checked_record.schema_name AND p.proname=checked_record.function_name
      AND p.prokind='f';
    IF NOT f.prosecdef OR pg_get_userbyid(f.proowner) <> 'postgres'
       OR NOT coalesce(f.proconfig @> ARRAY['row_security=off'],false) THEN
      RAISE EXCEPTION 'Definer/owner/row_security diverge: %',f.oid::regprocedure;
    END IF;
    IF checked_record.schema_name='public'
       AND NOT has_function_privilege('authenticated',f.oid,'EXECUTE') THEN
      RAISE EXCEPTION 'EXECUTE necessario ausente: %',f.oid::regprocedure;
    END IF;
    -- row_security=off nao concede bypass. Aceitar bypass ou ownership sem FORCE.
    IF NOT EXISTS (SELECT FROM pg_roles owner_role JOIN pg_class c ON c.oid=target
        WHERE owner_role.oid=f.proowner AND (owner_role.rolsuper OR owner_role.rolbypassrls
          OR (c.relowner=f.proowner AND NOT c.relforcerowsecurity)))
       OR EXISTS (SELECT FROM unnest(checked_record.needed_privileges) AS needed(privilege)
          WHERE NOT has_table_privilege(f.proowner,target,needed.privilege)) THEN
      RAISE EXCEPTION 'Owner sem privilegio/bypass necessario: %',f.oid::regprocedure;
    END IF;
  END LOOP;
  -- Snapshot de SELECT/DELETE para TODOS os papeis; nao ampliar nem reduzir.
  SELECT jsonb_object_agg(rolname,jsonb_build_array(
      has_table_privilege(oid,target,'SELECT'),has_table_privilege(oid,target,'DELETE')))
    INTO before_access FROM pg_roles;

  -- Unica mutacao de ACL: PUBLIC/colunas nao possuem grants a revogar.
  -- postgres, outros papeis, SELECT e DELETE permanecem intocados.
  REVOKE INSERT, UPDATE ON TABLE public.band_members FROM authenticated RESTRICT;

  -- Heranca, PUBLIC residual, grants de outro grantor e privilegios implicitos:
  -- falhar e reverter tudo, sem revogar de papeis compartilhados.
  FOR checked_record IN SELECT oid,rolname FROM pg_roles
    WHERE rolname IN ('authenticated','anon')
      OR pg_has_role('authenticated',oid,'MEMBER')
      OR pg_has_role('anon',oid,'MEMBER')
  LOOP
    IF has_table_privilege(checked_record.oid,target,'INSERT') OR has_table_privilege(checked_record.oid,target,'UPDATE')
       OR has_any_column_privilege(checked_record.oid,target,'INSERT')
       OR has_any_column_privilege(checked_record.oid,target,'UPDATE') THEN
      RAISE EXCEPTION 'Escrita residual via papel %; revisar grants/heranca separadamente',checked_record.rolname;
    END IF;
  END LOOP;
  SELECT jsonb_object_agg(rolname,jsonb_build_array(
      has_table_privilege(oid,target,'SELECT'),has_table_privilege(oid,target,'DELETE')))
    INTO after_access FROM pg_roles;
  IF before_access IS DISTINCT FROM after_access THEN
    RAISE EXCEPTION 'SELECT/DELETE alterados inesperadamente';
  END IF;
  IF NOT has_table_privilege('postgres',target,'INSERT')
     OR NOT has_table_privilege('postgres',target,'UPDATE') THEN
    RAISE EXCEPTION 'Escrita de postgres alterada inesperadamente';
  END IF;
  -- Revalidar somente as capacidades exigidas por cada fluxo apos REVOKE.
  FOR checked_record IN SELECT * FROM (VALUES
    ('private','add_band_creator_as_admin',ARRAY['INSERT']::text[]),
    ('public','bandup_decide_entry',ARRAY['SELECT','INSERT']::text[]),
    ('public','bandup_leave_band',ARRAY['SELECT','UPDATE','DELETE']::text[])
  ) AS required(schema_name,function_name,needed_privileges)
  LOOP
    SELECT p.* INTO STRICT f FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname=checked_record.schema_name AND p.proname=checked_record.function_name AND p.prokind='f';
    IF EXISTS (SELECT FROM unnest(checked_record.needed_privileges) AS needed(privilege)
        WHERE NOT has_table_privilege(f.proowner,target,needed.privilege)) THEN
      RAISE EXCEPTION 'Owner perdeu escrita: %',f.oid::regprocedure;
    END IF;
  END LOOP;
END;
$proposal$;
COMMIT;
