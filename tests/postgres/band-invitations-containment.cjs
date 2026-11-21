/* eslint-disable @typescript-eslint/no-require-imports */
// Specific opt-in selection; never runs the general or compatibility suites.
const {randomUUID}=require('node:crypto');
module.exports=async({context,sql,read,quote:q,check,openSession,wait})=>{
  const candidate=read('docs/band-invitations-containment-candidate.sql');
  const invite='public.bandup_invite_musician(uuid,uuid)',decide='public.bandup_decide_invitation(uuid,text)';
  await sql(context,read('tests/postgres/band-invitations-fixture.sql'));
  const fixture=read('tests/postgres/band-invitations-fixture.sql')
    .replace('CREATE ROLE anon NOLOGIN;','').replace('CREATE ROLE authenticated NOLOGIN;','')
    .replace('CREATE ROLE service_role NOLOGIN BYPASSRLS;','');
  async function fresh(backend=true){
    const database='bandup_invites_test_'+randomUUID().replaceAll('-','').slice(0,12);
    await sql(context,`CREATE DATABASE "${database}";`,null,'postgres');
    const c={...context,database};await sql(c,fixture);
    if(backend)await sql(c,read('docs/band-invitations-backend-candidate.sql'));
    return c;
  }
  const scalar=async(c,query)=>(await sql(c,query)).out.trim();
  const assert=async(c,expression)=>check(await scalar(c,`SELECT (${expression});`)==='t',expression);
  const targets=`'${invite}'::regprocedure,'${decide}'::regprocedure`;
  const acls=c=>scalar(c,`SELECT jsonb_object_agg(oid::text,proacl::text) FROM pg_proc WHERE oid IN (${targets});`);
  const unrelated=c=>scalar(c,`SELECT jsonb_build_object(
    'functions',(SELECT jsonb_object_agg(oid::text,jsonb_build_array(proacl::text,prosrc,proconfig,proowner)) FROM pg_proc WHERE oid NOT IN (${targets})),
    'tables',(SELECT jsonb_object_agg(oid::text,jsonb_build_array(relacl::text,relrowsecurity,relforcerowsecurity)) FROM pg_class WHERE relnamespace IN ('public'::regnamespace,'private'::regnamespace)),
    'members',(SELECT count(*) FROM public.band_members),'invitations',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.band_invitations i),
    'constraints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY oid) FROM pg_constraint c));`);
  const pass=async(name,fn)=>{await fn();context.passed++;console.log('PASS: '+name);};
  const grants=c=>assert(c,`has_function_privilege('authenticated','${invite}','EXECUTE') AND has_function_privilege('authenticated','${decide}','EXECUTE')`);

  await pass('exact revocation, real client permission denial, unrelated state preserved and idempotence',async()=>{
    const c=await fresh(),before=await unrelated(c);
    await sql(c,candidate);await sql(c,candidate);
    await assert(c,`NOT has_function_privilege('authenticated','${invite}','EXECUTE') AND NOT has_function_privilege('authenticated','${decide}','EXECUTE') AND NOT has_function_privilege('anon','${invite}','EXECUTE')`);
    await sql(c,'SET ROLE authenticated; SELECT public.bandup_invite_musician(NULL,NULL);','42501');
    await sql(c,'SET ROLE authenticated; SELECT public.bandup_decide_invitation(NULL,NULL);','42501');
    await assert(c,"has_function_privilege('authenticated','public.bandup_list_invitations(uuid,integer,integer)','EXECUTE') AND has_function_privilege('authenticated','public.bandup_discover_musicians_for_invites(text,integer,integer)','EXECUTE') AND NOT has_table_privilege('authenticated','public.band_members','INSERT,UPDATE')");
    check(await unrelated(c)===before,'Unrelated catalog/data changed');
  });
  for(const [name,grant] of [
    ['PUBLIC',`GRANT EXECUTE ON FUNCTION ${decide} TO PUBLIC;`],
    ['other role',`GRANT EXECUTE ON FUNCTION ${decide} TO service_role;`],
    ['inherited role',`CREATE ROLE invites_inherited NOLOGIN; GRANT invites_inherited TO authenticated; GRANT EXECUTE ON FUNCTION ${decide} TO invites_inherited;`],
    ['grant option',`GRANT EXECUTE ON FUNCTION ${decide} TO authenticated WITH GRANT OPTION;`]
  ])await pass('unexpected '+name+' aborts atomically without broadening revocations',async()=>{
    const c=await fresh();await sql(c,grant);const before=await acls(c);
    await sql(c,candidate,'P0001');check(await acls(c)===before,'ACL modified on failed containment');await grants(c);
  });
  await pass('client membership reaching owner aborts without ACL changes',async()=>{
    const c=await fresh();await sql(c,'GRANT postgres TO anon;');const before=await acls(c);
    try{await sql(c,candidate,'P0001');check(await acls(c)===before,'Owner path changed ACL');}
    finally{await sql(c,'REVOKE postgres FROM anon;');}
  });
  await pass('missing backend fails closed',async()=>{
    const c=await fresh(false);await sql(c,candidate,'P0001');
    await assert(c,"to_regprocedure('public.bandup_invite_musician(uuid,uuid)') IS NULL");
  });
  await pass('decision already executed in open transaction can commit after containment; pending rows preserved',async()=>{
    const c=await fresh(),actor=randomUUID(),admin=randomUUID(),band=randomUUID(),id=randomUUID(),pending=randomUUID();
    await sql(c,`INSERT INTO auth.users(id) VALUES(${q(actor)}),(${q(admin)});INSERT INTO public.bands VALUES(${q(band)},'test');
      INSERT INTO public.band_invitations(id,band_id,recipient_id,invited_by) VALUES(${q(id)},${q(band)},${q(actor)},${q(admin)});
      INSERT INTO public.bands VALUES(${q(pending)},'pending');
      INSERT INTO public.band_invitations(band_id,recipient_id,invited_by) VALUES(${q(pending)},${q(actor)},${q(admin)});`);
    const session=await openSession(c);
    try{
      session.child.stdin.write(`BEGIN;SET ROLE authenticated;SET request.jwt.claim.sub=${q(actor)};SET request.jwt.claim.role='authenticated';SELECT public.bandup_decide_invitation(${q(id)},'rejected');SELECT 'DECISION_READY';\n`);
      const deadline=Date.now()+6000;
      while(!session.output().includes('DECISION_READY')){check(Date.now()<deadline,'Decision marker missing');await wait(10);}
      await sql(c,candidate);
      session.child.stdin.end('COMMIT;\n');const result=await session.done;check(result.code===0,result.err);
      await assert(c,`EXISTS(SELECT FROM public.band_invitations WHERE id=${q(id)} AND status='rejected' AND decided_at IS NOT NULL)
        AND EXISTS(SELECT FROM public.band_invitations WHERE band_id=${q(pending)} AND status='pending' AND decided_at IS NULL)`);
    }finally{session.child.stdin.end();await session.done;}
  });
};
