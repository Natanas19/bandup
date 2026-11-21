/* eslint-disable @typescript-eslint/no-require-imports */
const {randomUUID}=require('node:crypto');
module.exports=async({context,sql,read,quote:q,check,openSession,wait})=>{
  const source=read('docs/band-invitations-backend-candidate.sql');
  const anchor='CREATE TRIGGER musician_availability_invitation_ref AFTER INSERT OR UPDATE OF available';
  check(source.split(anchor).length===2,'Installation anchor ambiguous');
  const index=source.indexOf(anchor),prefix=source.slice(0,index),tail=source.slice(index);
  check(tail.indexOf('INSERT INTO private.musician_invitation_refs')>0,'Trigger must precede backfill');
  const fixture=read('tests/postgres/band-invitations-fixture.sql');
  await sql(context,'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;');
  let schema=fixture;
  for(const statement of ['CREATE ROLE anon NOLOGIN;','CREATE ROLE authenticated NOLOGIN;','CREATE ROLE service_role NOLOGIN BYPASSRLS;']){
    check(schema.includes(statement),'Fixture role changed');schema=schema.replace(statement,'');
  }
  async function fresh(){
    const database='bandup_invites_test_'+randomUUID().replaceAll('-','').slice(0,12);
    await sql(context,`CREATE DATABASE "${database}";`,null,'postgres');
    const isolated={...context,database};await sql(isolated,schema);return isolated;
  }
  const scalar=async(c,query)=>(await sql(c,query)).out.trim();
  const assert=async(c,expr)=>check(await scalar(c,`SELECT (${expr});`)==='t','Assertion failed: '+expr);
  const pass=async(name,fn)=>{await fn();context.passed++;console.log('PASS: '+name);};
  async function until(fn,label){const deadline=Date.now()+6000;while(!await fn()){check(Date.now()<deadline,label);await wait(10);}}
  async function marker(session,label){await until(()=>session.output().includes(label),'Missing marker: '+label);}
  async function finish(session,query='COMMIT;'){
    session.child.stdin.end(query+'\n');const result=await session.done;
    check(result.code===0,'Session failed: '+result.err);return result;
  }
  async function waiting(c,name,mode){
    await until(async()=>await scalar(c,`SELECT EXISTS(SELECT FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid
      WHERE a.datname=current_database() AND a.application_name=${q(name)} AND l.relation='public.musician_availability'::regclass
      AND NOT l.granted AND l.mode=${q(mode)});`)==='t','Expected waiting lock: '+name);
  }
  const absent=c=>assert(c,"to_regclass('private.musician_invitation_refs') IS NULL AND to_regclass('public.band_invitations') IS NULL AND NOT EXISTS(SELECT FROM pg_trigger WHERE tgname='musician_availability_invitation_ref')");
  await pass('installation rejects stale-snapshot isolation levels before creating objects',async()=>{
    const c=await fresh();
    for(const level of ['REPEATABLE READ','SERIALIZABLE']){
      const changed=source.replace('\nBEGIN;','\nBEGIN ISOLATION LEVEL '+level+';');
      check(changed!==source,'Missing initial transaction');await sql(c,changed,'25001');await absent(c);
    }
  });
  await pass('INSERT and UPDATE before trigger commit into fresh backfill snapshot; no missing available identity',async()=>{
    const c=await fresh(),user=randomUUID(),inserted=randomUUID();
    await sql(c,`INSERT INTO auth.users(id) VALUES(${q(user)}),(${q(inserted)});INSERT INTO public.musician_availability VALUES(${q(user)},false);`);
    const installer=await openSession(c),writer=await openSession(c);
    try{
      installer.child.stdin.write(`SET application_name='invites_install_before';\n`+prefix+"SELECT 'PREFIX_READY';\n");await marker(installer,'PREFIX_READY');
      writer.child.stdin.write(`BEGIN;UPDATE public.musician_availability SET available=true WHERE user_id=${q(user)};INSERT INTO public.musician_availability VALUES(${q(inserted)},true);SELECT 'WRITER_READY';\n`);await marker(writer,'WRITER_READY');
      installer.child.stdin.write(tail);
      await waiting(c,'invites_install_before','ShareRowExclusiveLock');
      await finish(writer);await finish(installer,'');
      await assert(c,`(SELECT count(*)=2 FROM private.musician_invitation_refs WHERE user_id IN (${q(user)},${q(inserted)}))
        AND NOT EXISTS(SELECT FROM public.musician_availability a LEFT JOIN private.musician_invitation_refs r USING(user_id) WHERE a.available AND r.user_id IS NULL)`);
    }finally{installer.child.stdin.end();writer.child.stdin.end();await Promise.all([installer.done,writer.done]);}
  });
  await pass('new INSERT and UPDATE wait until installation commit; SELECT works; trigger covers both',async()=>{
    const c=await fresh(),updated=randomUUID(),inserted=randomUUID();
    await sql(c,`INSERT INTO auth.users(id) VALUES(${q(updated)}),(${q(inserted)});INSERT INTO public.musician_availability VALUES(${q(updated)},false);`);
    const installer=await openSession(c),writer=await openSession(c),inserter=await openSession(c);
    try{
      // Pause actual candidate after trigger/backfill, immediately before COMMIT.
      installer.child.stdin.write(prefix+tail.replace(/COMMIT;\s*$/,"SELECT 'INSTALLATION_HELD';\n"));await marker(installer,'INSTALLATION_HELD');
      await assert(c,"EXISTS(SELECT FROM pg_locks WHERE relation='public.musician_availability'::regclass AND mode='ShareRowExclusiveLock' AND granted)");
      await assert(c,`EXISTS(SELECT FROM public.musician_availability WHERE user_id=${q(updated)} AND NOT available)`);
      writer.child.stdin.write(`SET application_name='invites_update_wait';BEGIN;UPDATE public.musician_availability SET available=true WHERE user_id=${q(updated)};COMMIT;\n`);
      inserter.child.stdin.write(`SET application_name='invites_insert_wait';BEGIN;INSERT INTO public.musician_availability VALUES(${q(inserted)},true);COMMIT;\n`);
      await waiting(c,'invites_update_wait','RowExclusiveLock');await waiting(c,'invites_insert_wait','RowExclusiveLock');
      await finish(installer);await finish(writer,'');await finish(inserter,'');
      await assert(c,`(SELECT count(*)=2 FROM private.musician_invitation_refs WHERE user_id IN (${q(updated)},${q(inserted)}))
        AND NOT EXISTS(SELECT FROM public.musician_availability a LEFT JOIN private.musician_invitation_refs r USING(user_id) WHERE a.available AND r.user_id IS NULL)`);
    }finally{for(const session of [installer,writer,inserter])session.child.stdin.end();await Promise.all([installer.done,writer.done,inserter.done]);}
  });
  await pass('trigger lock timeout rolls back whole candidate and preserves competing writer',async()=>{
    const c=await fresh(),user=randomUUID();
    await sql(c,`INSERT INTO auth.users(id) VALUES(${q(user)});INSERT INTO public.musician_availability VALUES(${q(user)},false);`);
    const writer=await openSession(c),installer=await openSession(c);
    try{
      installer.child.stdin.write(prefix+"SELECT 'TIMEOUT_PREFIX_READY';\n");await marker(installer,'TIMEOUT_PREFIX_READY');
      writer.child.stdin.write(`BEGIN;UPDATE public.musician_availability SET available=true WHERE user_id=${q(user)};SELECT 'TIMEOUT_WRITER_READY';\n`);await marker(writer,'TIMEOUT_WRITER_READY');
      installer.child.stdin.end(tail);const result=await installer.done;
      check(result.code!==0&&/ERROR:\s+55P03:/.test(result.err),'Expected original 3s lock_timeout');
      await absent(c);await finish(writer);
      await assert(c,`EXISTS(SELECT FROM public.musician_availability WHERE user_id=${q(user)} AND available)`);
    }finally{installer.child.stdin.end();writer.child.stdin.end();await Promise.all([installer.done,writer.done]);}
  });
};
