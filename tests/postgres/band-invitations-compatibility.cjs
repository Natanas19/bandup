/* eslint-disable @typescript-eslint/no-require-imports */
// Models ONLY the ordering/security characteristics supplied by the user.
// Not a snapshot or a certification of the installed Demo function.
const { randomUUID } = require('node:crypto');
module.exports = async ({ context, sql, read, quote:q, check, openSession, wait }) => {
  const pass = async (name,fn) => { await fn(); context.passed++; console.log('PASS: '+name); };
  const scalar = async query => (await sql(context,query)).out.trim();
  const assert = async expr => check(await scalar(`SELECT (${expr});`)==='t','Assertion failed: '+expr);
  const [admin,recipient,band] = Array.from({length:3},randomUUID);
  const identity = actor => `SET request.jwt.claim.sub=${q(actor)}; SET request.jwt.claim.role='authenticated'; SET ROLE authenticated;`;
  const as = (actor,query,state) => sql(context,identity(actor)+query,state);
  await sql(context,read('tests/postgres/band-invitations-fixture.sql'));
  await sql(context,`CREATE OR REPLACE FUNCTION public.bandup_decide_entry(p_request_id uuid,p_decision text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET row_security=off AS $$
    DECLARE req public.band_join_requests%ROWTYPE; target uuid;
    BEGIN
      IF auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501'; END IF;
      SELECT band_id INTO target FROM public.band_join_requests WHERE id=p_request_id;
      PERFORM 1 FROM public.band_members WHERE band_id=target AND user_id=auth.uid() AND role='admin' FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501'; END IF;
      PERFORM 1 FROM public.bands WHERE id=target FOR UPDATE;
      SELECT * INTO req FROM public.band_join_requests WHERE id=p_request_id FOR UPDATE;
      IF NOT FOUND OR req.status<>'pending' THEN RAISE EXCEPTION USING ERRCODE='55000'; END IF;
      IF p_decision IS NULL OR p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION USING ERRCODE='22023'; END IF;
      IF p_decision='approved' THEN
        INSERT INTO public.band_members(band_id,user_id,role) VALUES(req.band_id,req.requester_id,'member');
      END IF;
      UPDATE public.band_join_requests SET status=p_decision,decided_at=clock_timestamp(),decided_by=auth.uid() WHERE id=p_request_id;
    END $$;
    CREATE FUNCTION public.compatibility_hold_admin(p_band_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET row_security=off AS $$
    BEGIN
      PERFORM 1 FROM public.band_members WHERE band_id=p_band_id AND user_id=auth.uid() AND role='admin' FOR SHARE;
    END $$;
    REVOKE ALL ON FUNCTION public.compatibility_hold_admin(uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.compatibility_hold_admin(uuid) TO authenticated;
    INSERT INTO auth.users(id) VALUES(${q(admin)}),(${q(recipient)});
    INSERT INTO public.bands VALUES(${q(band)},'Compatibility');
    INSERT INTO public.band_members(band_id,user_id,role) VALUES(${q(band)},${q(admin)},'admin');
    INSERT INTO public.musician_availability VALUES(${q(recipient)},true);`);
  await sql(context,read('docs/band-invitations-backend-candidate.sql'));
  const ref=await scalar(`SELECT musician_ref FROM private.musician_invitation_refs WHERE user_id=${q(recipient)}`);
  const setup = async()=>{
    await sql(context,`DELETE FROM public.band_join_requests; DELETE FROM public.band_invitations;
      DELETE FROM public.band_members WHERE user_id=${q(recipient)};`);
    const request=await scalar(`INSERT INTO public.band_join_requests(band_id,requester_id,applicant_name)
      VALUES(${q(band)},${q(recipient)},'Recipient') RETURNING id;`);
    const invitation=(await as(admin,`SELECT public.bandup_invite_musician(${q(band)},${q(ref)});`)).out.trim();
    return { request,invitation };
  };
  const held = async (actor,query,marker)=>{
    const session=await openSession(context);
    session.child.stdin.write(identity(actor)+`BEGIN; ${query} SELECT '${marker}';\n`);
    const deadline=Date.now()+5000;
    try {
      while(!session.output().includes(marker)) { check(Date.now()<deadline,'Session marker timeout: '+marker); await wait(10); }
      return session;
    } catch(error) { session.child.stdin.end('ROLLBACK;\n'); await session.done; throw error; }
  };
  const finish=async(session,query='COMMIT;')=>{ session.child.stdin.end(query+'\n'); check((await session.done).code===0,'Held session failed'); };
  await pass('member-first approval reacquires its own band lock with NOWAIT and supersedes on commit',async()=>{
    const { request,invitation }=await setup();
    const session=await held(admin,`SELECT public.bandup_decide_entry(${q(request)},'approved');`,'APPROVED_HELD');
    try { await assert(`EXISTS(SELECT FROM public.band_invitations WHERE id=${q(invitation)} AND status='pending')`); }
    finally { await finish(session); }
    await assert(`EXISTS(SELECT FROM public.band_join_requests WHERE id=${q(request)} AND status='approved')
      AND EXISTS(SELECT FROM public.band_invitations WHERE id=${q(invitation)} AND status='superseded')
      AND (SELECT count(*)=1 FROM public.band_members WHERE band_id=${q(band)} AND user_id=${q(recipient)} AND role='member')`);
  });
  await pass('rejection with confirmed lock order leaves invitation pending',async()=>{
    const { request,invitation }=await setup();
    await as(admin,`SELECT public.bandup_decide_entry(${q(request)},'rejected');`);
    await assert(`EXISTS(SELECT FROM public.band_invitations WHERE id=${q(invitation)} AND status='pending')
      AND NOT EXISTS(SELECT FROM public.band_members WHERE user_id=${q(recipient)})`);
  });
  await pass('admin SHARE then band versus send band then admin UPDATE fails busy instead of deadlock',async()=>{
    const { request }=await setup();
    // Stop approval immediately after its first lock, before its band lock.
    const session=await held(admin,`SELECT public.compatibility_hold_admin(${q(band)});`,'ADMIN_SHARE_HELD');
    try {
      await as(admin,`SELECT public.bandup_invite_musician(${q(band)},${q(ref)});`,'55P03');
    } finally { await finish(session,`SELECT public.bandup_decide_entry(${q(request)},'approved'); COMMIT;`); }
    await assert(`EXISTS(SELECT FROM public.band_join_requests WHERE id=${q(request)} AND status='approved')`);
  });
  await pass('approval owns band: concurrent acceptance fails busy; approval still commits',async()=>{
    const { request,invitation }=await setup();
    const session=await held(admin,`SELECT public.bandup_decide_entry(${q(request)},'approved');`,'BAND_APPROVAL_HELD');
    try { await as(recipient,`SELECT public.bandup_decide_invitation(${q(invitation)},'accepted');`,'55P03'); }
    finally { await finish(session); }
    await assert(`EXISTS(SELECT FROM public.band_invitations WHERE id=${q(invitation)} AND status='superseded')`);
  });
  await pass('acceptance owns band: approval waits there then sees superseded request, without duplicate',async()=>{
    const { request,invitation }=await setup();
    const accepting=await held(recipient,`SELECT public.bandup_decide_invitation(${q(invitation)},'accepted');`,'ACCEPTANCE_HELD');
    const approving=await openSession(context);
    approving.child.stdin.write(identity(admin)+`SET application_name='bandup_invitation_compat_wait'; SET lock_timeout='5s';
      SELECT public.bandup_decide_entry(${q(request)},'approved');\n`);
    try {
      const deadline=Date.now()+4000;
      while(await scalar("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='bandup_invitation_compat_wait' AND wait_event_type='Lock');")!=='t') {
        check(Date.now()<deadline,'Approval did not wait on lock'); await wait(10);
      }
    } finally { await finish(accepting); approving.child.stdin.end(); }
    const result=await approving.done;
    check(result.code!==0 && /ERROR:\s+55000:/.test(result.err),'Approval must reject superseded request, not deadlock');
    await assert(`EXISTS(SELECT FROM public.band_invitations WHERE id=${q(invitation)} AND status='accepted')
      AND EXISTS(SELECT FROM public.band_join_requests WHERE id=${q(request)} AND status='superseded')
      AND (SELECT count(*)=1 FROM public.band_members WHERE band_id=${q(band)} AND user_id=${q(recipient)})`);
  });
};
