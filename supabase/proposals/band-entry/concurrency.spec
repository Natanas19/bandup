# PostgreSQL isolationtester specification. PREPARED, NOT EXECUTED.
# Only a NEW, explicitly reviewed disposable cluster; never bandup-demo.
# Setup deliberately refuses execution until identity and schema review.
setup
{
  DO $$ BEGIN RAISE EXCEPTION 'Band entry concurrency target not reviewed; execution disabled'; END $$;
  INSERT INTO auth.users(id) VALUES
    ('b3000000-0000-0000-0000-000000000001'),
    ('b3000000-0000-0000-0000-000000000002'),
    ('b3000000-0000-0000-0000-000000000003');
  SELECT set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000001',false);
  INSERT INTO public.bands(id,name,slug)
    VALUES('b4000000-0000-0000-0000-000000000001','Concurrent synthetic','join-proposal-concurrent');
  INSERT INTO public.band_members(band_id,user_id,role)
    VALUES('b4000000-0000-0000-0000-000000000001','b3000000-0000-0000-0000-000000000002','admin');
  SELECT public.bandup_set_discovery('b4000000-0000-0000-0000-000000000001','Synthetic discovery','',true);
  INSERT INTO public.band_join_requests(id,band_id,requester_id,applicant_name)
    VALUES('b5000000-0000-0000-0000-000000000001','b4000000-0000-0000-0000-000000000001',
      'b3000000-0000-0000-0000-000000000003','Concurrent applicant');
}

teardown
{
  DELETE FROM public.bands WHERE id='b4000000-0000-0000-0000-000000000001';
  DELETE FROM auth.users WHERE id IN ('b3000000-0000-0000-0000-000000000001',
    'b3000000-0000-0000-0000-000000000002','b3000000-0000-0000-0000-000000000003');
}

session "admin_a"
setup { SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000001',false); }
step "a_begin" { BEGIN; }
step "a_approve" { SELECT public.bandup_decide_entry('b5000000-0000-0000-0000-000000000001','approved'); }
step "a_reject" { SELECT public.bandup_decide_entry('b5000000-0000-0000-0000-000000000001','rejected'); }
step "a_commit" { COMMIT; }
step "check_approved" {
  SELECT 1 / ((SELECT count(*)=1 AND bool_and(role='member') FROM public.band_members
    WHERE band_id='b4000000-0000-0000-0000-000000000001' AND user_id='b3000000-0000-0000-0000-000000000003')
    AND COALESCE((SELECT status='approved' FROM public.band_join_requests WHERE id='b5000000-0000-0000-0000-000000000001'),false))::integer;
}
step "check_cancelled" {
  SELECT 1 / ((NOT EXISTS (SELECT 1 FROM public.band_members
    WHERE band_id='b4000000-0000-0000-0000-000000000001' AND user_id='b3000000-0000-0000-0000-000000000003'))
    AND COALESCE((SELECT status='cancelled' FROM public.band_join_requests WHERE id='b5000000-0000-0000-0000-000000000001'),false))::integer;
}
step "check_rejected" {
  SELECT 1 / ((NOT EXISTS (SELECT 1 FROM public.band_members
    WHERE band_id='b4000000-0000-0000-0000-000000000001' AND user_id='b3000000-0000-0000-0000-000000000003'))
    AND COALESCE((SELECT status='rejected' FROM public.band_join_requests WHERE id='b5000000-0000-0000-0000-000000000001'),false))::integer;
}

session "admin_b"
setup { SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000002',false); }
step "b_approve" { SELECT public.bandup_decide_entry('b5000000-0000-0000-0000-000000000001','approved'); }
step "b_reject" { SELECT public.bandup_decide_entry('b5000000-0000-0000-0000-000000000001','rejected'); }
step "b_begin" { BEGIN; }
step "b_demote_a" {
  UPDATE public.band_members SET role='member' WHERE band_id='b4000000-0000-0000-0000-000000000001'
    AND user_id='b3000000-0000-0000-0000-000000000001';
}
step "b_commit" { COMMIT; }
step "b_check_pending" {
  SELECT 1 / ((NOT EXISTS (SELECT 1 FROM public.band_members
    WHERE band_id='b4000000-0000-0000-0000-000000000001' AND user_id='b3000000-0000-0000-0000-000000000003'))
    AND COALESCE((SELECT status='pending' FROM public.band_join_requests WHERE id='b5000000-0000-0000-0000-000000000001'),false))::integer;
}

session "applicant"
setup { SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','b3000000-0000-0000-0000-000000000003',false); }
step "c_begin" { BEGIN; }
step "c_cancel" { SELECT public.bandup_cancel_entry('b5000000-0000-0000-0000-000000000001'); }
step "c_commit" { COMMIT; }

# The blocked loser must finish with SQLSTATE 55000 (not pending), never success.
permutation "a_begin" "a_approve" "b_approve" "a_commit" "check_approved"
permutation "a_begin" "a_approve" "b_reject" "a_commit" "check_approved"
permutation "a_begin" "a_reject" "b_approve" "a_commit" "check_rejected"
permutation "a_begin" "a_approve" "c_cancel" "a_commit" "check_approved"
permutation "c_begin" "c_cancel" "a_approve" "c_commit" "check_cancelled"
# Revocation that wins the lock race must make the waiting former admin fail 42501.
permutation "b_begin" "b_demote_a" "a_approve" "b_commit" "b_check_pending"
