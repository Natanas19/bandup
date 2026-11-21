/* eslint-disable @typescript-eslint/no-require-imports */
const { randomUUID } = require('node:crypto');
module.exports = async ({ context, sql, read, quote:q, check, openSession, wait }) => {
  const pass = async (name,fn) => { await fn(); context.passed++; console.log('PASS: '+name); };
  const scalar = async query => (await sql(context,query)).out.trim();
  const assert = async expression => check(await scalar(`SELECT (${expression});`)==='t','Assertion failed: '+expression);
  const as = (actor,query,state) => sql(context,`SET request.jwt.claim.sub=${q(actor)}; SET request.jwt.claim.role='authenticated'; SET ROLE authenticated; ${query}`,state);
  const [admin,other,recipient,band,band2] = Array.from({length:5},randomUUID);
  await sql(context,read('tests/postgres/band-invitations-fixture.sql'));
  await sql(context,`INSERT INTO auth.users(id) VALUES(${q(admin)}),(${q(other)}),(${q(recipient)});
    INSERT INTO public.bands VALUES(${q(band)},'Band'),(${q(band2)},'Other');
    INSERT INTO public.band_members(band_id,user_id,role) VALUES(${q(band)},${q(admin)},'admin'),(${q(band2)},${q(admin)},'admin');
    INSERT INTO public.musician_availability VALUES(${q(recipient)},true),(${q(admin)},true);`);
  await pass('hardening gate rejects writable membership without partial installation',async()=>{
    await sql(context,'GRANT INSERT ON public.band_members TO authenticated;');
    await sql(context,read('docs/band-invitations-backend-candidate.sql'),'P0001');
    await assert("to_regclass('public.band_invitations') IS NULL");
    await sql(context,'REVOKE INSERT ON public.band_members FROM authenticated;');
  });
  await sql(context,read('docs/band-invitations-backend-candidate.sql'));
  const ref = await scalar(`SELECT musician_ref FROM private.musician_invitation_refs WHERE user_id=${q(recipient)}`);
  const send = async (b=band) => (await as(admin,`SELECT public.bandup_invite_musician(${q(b)},${q(ref)});`)).out.trim();
  const req = async (b=band) => await scalar(`INSERT INTO public.band_join_requests(band_id,requester_id,applicant_name)
    VALUES(${q(b)},${q(recipient)},'Musician') RETURNING id`);
  const reset = async()=>sql(context,`DELETE FROM public.band_members WHERE user_id=${q(recipient)};
    DELETE FROM public.band_invitations; DELETE FROM public.band_join_requests;`);
  await pass('opaque identity has no Auth UUID and discovery hides self/unavailable refs',async()=>{
    check(ref!==recipient,'Auth identity leaked');
    const result=await as(admin,"SELECT row_to_json(d) FROM public.bandup_discover_musicians_for_invites('',0,20) d;");
    check(!result.out.includes(recipient)&&!result.out.includes(admin),'Auth UUID leaked');
    await assert(`(SELECT count(*)=1 FROM private.musician_invitation_refs WHERE user_id=${q(recipient)})`);
  });
  await pass('direct tables and private functions are denied',async()=>{
    await as(admin,'SELECT * FROM public.band_invitations;','42501');
    await as(admin,'SELECT * FROM private.musician_invitation_refs;','42501');
    await as(admin,`INSERT INTO public.band_members(band_id,user_id,role) VALUES(${q(band)},${q(recipient)},'member');`,'42501');
    await sql(context,`SET ROLE anon; SELECT public.bandup_list_invitations();`,'42501');
    await sql(context,`SET ROLE service_role; SELECT public.bandup_list_invitations();`,'42501');
  });
  await pass('only current admin may send; availability and self checked',async()=>{
    await as(other,`SELECT public.bandup_invite_musician(${q(band)},${q(ref)});`,'42501');
    await as(admin,`SELECT public.bandup_invite_musician(${q(band)},${q(recipient)});`,'42501');
    const self=await scalar(`SELECT musician_ref FROM private.musician_invitation_refs WHERE user_id=${q(admin)}`);
    await as(admin,`SELECT public.bandup_invite_musician(${q(band)},${q(self)});`,'42501');
    await as(recipient,`UPDATE public.musician_availability SET available=false WHERE user_id=${q(recipient)};`);
    await as(admin,`SELECT public.bandup_invite_musician(${q(band)},${q(ref)});`,'42501');
    await as(recipient,`UPDATE public.musician_availability SET available=true WHERE user_id=${q(recipient)};`);
  });
  await pass('coexistence and recipient-only atomic acceptance supersedes request',async()=>{
    const request=await req(), invitation=await send();
    await as(admin,`SELECT public.bandup_invite_musician(${q(band)},${q(ref)});`,'23505');
    await as(other,`SELECT public.bandup_decide_invitation(${q(invitation)},'accepted');`,'42501');
    await as(recipient,`SELECT public.bandup_decide_invitation(${q(invitation)},'approved');`,'22023');
    await as(recipient,`SELECT public.bandup_decide_invitation(${q(invitation)},'accepted');`);
    await assert(`EXISTS(SELECT FROM public.band_members WHERE band_id=${q(band)} AND user_id=${q(recipient)} AND role='member')
      AND EXISTS(SELECT FROM public.band_join_requests WHERE id=${q(request)} AND status='superseded')`);
    await sql(context,`DELETE FROM public.band_members WHERE user_id=${q(recipient)};`);
    await as(recipient,`SELECT public.bandup_decide_invitation(${q(invitation)},'accepted');`,'55000');
    await assert(`NOT EXISTS(SELECT FROM public.band_members WHERE user_id=${q(recipient)})`);
    await as(admin,`SELECT public.bandup_invite_musician(${q(band)},${q(ref)});`,'54000');
  });
  await reset();
  await pass('approval supersedes pending invitation at transaction completion',async()=>{
    const invitation=await send(),request=await req();
    await as(admin,`SELECT public.bandup_decide_entry(${q(request)},'approved');`);
    await assert(`EXISTS(SELECT FROM public.band_invitations WHERE id=${q(invitation)} AND status='superseded')`);
    await as(recipient,`SELECT public.bandup_decide_invitation(${q(invitation)},'accepted');`,'55000');
  });
  await reset();
  await pass('rejection of either process leaves the other pending',async()=>{
    let invitation=await send(),request=await req();
    await as(admin,`SELECT public.bandup_decide_entry(${q(request)},'rejected');`);
    await assert(`EXISTS(SELECT FROM public.band_invitations WHERE id=${q(invitation)} AND status='pending')`);
    await sql(context,`DELETE FROM public.band_join_requests;`); request=await req();
    await as(recipient,`SELECT public.bandup_decide_invitation(${q(invitation)},'rejected');`);
    await assert(`EXISTS(SELECT FROM public.band_join_requests WHERE id=${q(request)} AND status='pending') AND NOT EXISTS(SELECT FROM public.band_members WHERE user_id=${q(recipient)})`);
  });
  await reset();
  await pass('list projections hide identities and deny unrelated band readers',async()=>{
    await send();
    const own=await as(recipient,'SELECT row_to_json(i) FROM public.bandup_list_invitations() i;');
    check(!own.out.includes(recipient)&&!own.out.includes(admin)&&own.out.includes('Band'),'Invalid projection');
    check((await as(other,'SELECT * FROM public.bandup_list_invitations();')).out.trim()==='','Unrelated invitation leaked');
    await as(other,`SELECT public.bandup_list_invitations(${q(band)});`,'42501');
    await as(admin,'SELECT public.bandup_list_invitations(NULL,-1,20);','22023');
  });
  await reset();
  await pass('acceptance rolls back membership, request and invitation on later failure',async()=>{
    const invitation=await send(),request=await req();
    await as(recipient,`BEGIN; SELECT public.bandup_decide_invitation(${q(invitation)},'accepted'); SELECT 1/0; COMMIT;`,'22012');
    await assert(`NOT EXISTS(SELECT FROM public.band_members WHERE user_id=${q(recipient)}) AND EXISTS(SELECT FROM public.band_join_requests WHERE id=${q(request)} AND status='pending')
      AND EXISTS(SELECT FROM public.band_invitations WHERE id=${q(invitation)} AND status='pending')`);
  });
  await reset();
  await pass('concurrent approval and acceptance cannot duplicate membership',async()=>{
    const invitation=await send(),request=await req();
    const session=await openSession(context);
    session.child.stdin.write(`SET request.jwt.claim.sub=${q(admin)}; SET request.jwt.claim.role='authenticated'; SET ROLE authenticated;
      BEGIN; SELECT public.bandup_decide_entry(${q(request)},'approved'); SELECT 'APPROVAL_HELD';\n`);
    const deadline=Date.now()+5000;
    while(!session.output().includes('APPROVAL_HELD')) { check(Date.now()<deadline,'Approval did not acquire lock'); await wait(10); }
    try { await as(recipient,`SELECT public.bandup_decide_invitation(${q(invitation)},'accepted');`,'55P03'); }
    finally { session.child.stdin.end('COMMIT;\n'); check((await session.done).code===0,'Approval commit failed'); }
    await assert(`(SELECT count(*)=1 FROM public.band_members WHERE band_id=${q(band)} AND user_id=${q(recipient)}) AND EXISTS(SELECT FROM public.band_invitations WHERE id=${q(invitation)} AND status='superseded')`);
  });
  await reset();
  await pass('pending quota, sender daily quota and band daily quota are enforced',async()=>{
    const people=Array.from({length:11},randomUUID);
    for(const person of people) await sql(context,`INSERT INTO auth.users(id) VALUES(${q(person)}); INSERT INTO public.musician_availability VALUES(${q(person)},true);`);
    const refs=[];
    for(const person of people) refs.push(await scalar(`SELECT musician_ref FROM private.musician_invitation_refs WHERE user_id=${q(person)}`));
    for(const personRef of refs.slice(0,5)) await as(admin,`SELECT public.bandup_invite_musician(${q(band)},${q(personRef)});`);
    await as(admin,`SELECT public.bandup_invite_musician(${q(band)},${q(refs[5])});`,'54000');
    await sql(context,"UPDATE public.band_invitations SET status='rejected',decided_at=clock_timestamp();");
    for(const personRef of refs.slice(5,10)) await as(admin,`SELECT public.bandup_invite_musician(${q(band)},${q(personRef)});`);
    await sql(context,"UPDATE public.band_invitations SET status='rejected',decided_at=clock_timestamp() WHERE status='pending';");
    await as(admin,`SELECT public.bandup_invite_musician(${q(band2)},${q(refs[10])});`,'54000');
    await sql(context,`INSERT INTO public.band_members(band_id,user_id,role) VALUES(${q(band)},${q(other)},'admin');`);
    await as(other,`SELECT public.bandup_invite_musician(${q(band)},${q(refs[10])});`,'54000');
    await sql(context,`DELETE FROM public.band_members WHERE user_id=${q(other)};`);
  });
  await reset();
  await pass('simultaneous sends serialize duplicate and quota checks',async()=>{
    const session=await openSession(context);
    session.child.stdin.write(`SET request.jwt.claim.sub=${q(admin)}; SET request.jwt.claim.role='authenticated'; SET ROLE authenticated;
      BEGIN; SELECT public.bandup_invite_musician(${q(band)},${q(ref)}); SELECT 'SEND_HELD';\n`);
    const deadline=Date.now()+5000;
    while(!session.output().includes('SEND_HELD')) { check(Date.now()<deadline,'Send lock timeout'); await wait(10); }
    try { await as(admin,`SELECT public.bandup_invite_musician(${q(band2)},${q(ref)});`,'55P03'); }
    finally { session.child.stdin.end('COMMIT;\n'); check((await session.done).code===0,'Send commit failed'); }
    await assert('(SELECT count(*)=1 FROM public.band_invitations)');
  });
  await reset();
  await pass('acceptance first excludes simultaneous approval and preserves final states',async()=>{
    const invitation=await send(),request=await req();
    const session=await openSession(context);
    session.child.stdin.write(`SET request.jwt.claim.sub=${q(recipient)}; SET request.jwt.claim.role='authenticated'; SET ROLE authenticated;
      BEGIN; SELECT public.bandup_decide_invitation(${q(invitation)},'accepted'); SELECT 'ACCEPT_HELD';\n`);
    const deadline=Date.now()+5000;
    while(!session.output().includes('ACCEPT_HELD')) { check(Date.now()<deadline,'Accept lock timeout'); await wait(10); }
    // Legacy RPC may wait on request first; a bounded session timeout aborts it.
    try { await as(admin,`SET lock_timeout='200ms'; SELECT public.bandup_decide_entry(${q(request)},'approved');`,'55P03'); }
    finally { session.child.stdin.end('COMMIT;\n'); check((await session.done).code===0,'Accept commit failed'); }
    await as(admin,`SELECT public.bandup_decide_entry(${q(request)},'approved');`,'55000');
    await assert(`(SELECT count(*)=1 FROM public.band_members WHERE band_id=${q(band)} AND user_id=${q(recipient)})
      AND EXISTS(SELECT FROM public.band_join_requests WHERE id=${q(request)} AND status='superseded')`);
  });
  await reset();
  await pass('membership-first approval ordering also supersedes invitations',async()=>{
    const invitation=await send(),request=await req();
    await sql(context,`BEGIN; INSERT INTO public.band_members(band_id,user_id,role) VALUES(${q(band)},${q(recipient)},'member');
      UPDATE public.band_join_requests SET status='approved',decided_at=clock_timestamp(),decided_by=${q(admin)} WHERE id=${q(request)}; COMMIT;`);
    await assert(`EXISTS(SELECT FROM public.band_invitations WHERE id=${q(invitation)} AND status='superseded')`);
  });
  await reset();
  await pass('constraints reject impossible states and approval without membership',async()=>{
    const invitation=await send(),request=await req();
    await sql(context,`UPDATE public.band_invitations SET status='accepted' WHERE id=${q(invitation)};`,'23514');
    await sql(context,`UPDATE public.band_join_requests SET status='approved',decided_at=clock_timestamp(),decided_by=${q(admin)} WHERE id=${q(request)};`,'23514');
    await assert(`EXISTS(SELECT FROM public.band_join_requests WHERE id=${q(request)} AND status='pending')`);
  });
  await reset();
  await pass('cascade deletes invitations and private mapping',async()=>{
    await send(band2);
    await sql(context,`DELETE FROM public.bands WHERE id=${q(band2)}; DELETE FROM auth.users WHERE id=${q(recipient)};`);
    await assert(`NOT EXISTS(SELECT FROM public.band_invitations) AND NOT EXISTS(SELECT FROM private.musician_invitation_refs WHERE user_id=${q(recipient)})`);
  });
};
