-- Initial BandUp MVP schema. Apply only after review.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, service_role;
REVOKE ALL ON SCHEMA private FROM authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE TABLE public.bands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.band_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  band_id UUID NOT NULL REFERENCES public.bands (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (band_id, user_id)
);

CREATE TABLE public.social_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  band_id UUID NOT NULL REFERENCES public.bands (id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  band_id UUID NOT NULL REFERENCES public.bands (id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'done')),
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  due_date TIMESTAMPTZ,
  assigned_to UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tasks_assigned_to_band_member_fkey
    FOREIGN KEY (band_id, assigned_to)
    REFERENCES public.band_members (band_id, user_id)
);

CREATE TABLE public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  band_id UUID NOT NULL REFERENCES public.bands (id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'show',
      'rehearsal',
      'recording',
      'meeting',
      'interview',
      'photoshoot',
      'livestream',
      'other'
    )
  ),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ,
  location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_at IS NULL OR end_at >= start_at)
);

-- Index foreign keys and common band-scoped filters.
CREATE INDEX band_members_user_id_idx ON public.band_members (user_id);
CREATE INDEX social_links_band_id_idx ON public.social_links (band_id);
CREATE INDEX tasks_band_id_status_idx ON public.tasks (band_id, status);
CREATE INDEX tasks_band_id_due_date_idx ON public.tasks (band_id, due_date);
CREATE INDEX tasks_band_id_assigned_to_idx ON public.tasks (band_id, assigned_to);
CREATE INDEX tasks_created_by_idx ON public.tasks (created_by);
CREATE INDEX tasks_assigned_to_idx ON public.tasks (assigned_to);
CREATE INDEX events_band_id_start_at_idx ON public.events (band_id, start_at);
CREATE INDEX events_created_by_idx ON public.events (created_by);

-- These SECURITY DEFINER helpers avoid recursive RLS checks on band_members.
CREATE OR REPLACE FUNCTION private.is_band_member(p_band_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.band_members AS bm
    WHERE bm.band_id = p_band_id
      AND (SELECT auth.uid()) IS NOT NULL
      AND bm.user_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION private.is_band_admin(p_band_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.band_members AS bm
    WHERE bm.band_id = p_band_id
      AND (SELECT auth.uid()) IS NOT NULL
      AND bm.user_id = (SELECT auth.uid())
      AND bm.role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION private.is_band_member_for_user(
  p_band_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.band_members AS target_member
    WHERE p_user_id IS NOT NULL
      AND (SELECT auth.uid()) IS NOT NULL
      AND target_member.band_id = p_band_id
      AND target_member.user_id = p_user_id
      AND EXISTS (
        SELECT 1
        FROM public.band_members AS caller_membership
        WHERE caller_membership.band_id = p_band_id
          AND caller_membership.user_id = (SELECT auth.uid())
      )
  );
$$;

REVOKE ALL ON FUNCTION private.is_band_member(UUID)
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.is_band_admin(UUID)
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.is_band_member_for_user(UUID, UUID)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_band_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_band_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_band_member_for_user(UUID, UUID) TO authenticated;

-- New bands automatically start with their authenticated creator as admin.
CREATE OR REPLACE FUNCTION private.add_band_creator_as_admin()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'A band must be created by an authenticated user';
  END IF;

  INSERT INTO public.band_members (band_id, user_id, role)
  VALUES (NEW.id, (SELECT auth.uid()), 'admin');
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.add_band_creator_as_admin()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER bands_add_creator_as_admin
AFTER INSERT ON public.bands
FOR EACH ROW
EXECUTE FUNCTION private.add_band_creator_as_admin();

-- Prevent removing or demoting the last admin; lock the band row to serialize
-- concurrent membership changes. Band deletion cascades are allowed to proceed.
CREATE OR REPLACE FUNCTION private.prevent_last_band_admin_removal()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
DECLARE
  remaining_admins BIGINT;
  must_check_last_admin BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Change membership by removing and adding the member';
  END IF;

  IF TG_OP = 'DELETE' OR NEW.band_id IS DISTINCT FROM OLD.band_id THEN
    UPDATE public.tasks
    SET assigned_to = NULL
    WHERE band_id = OLD.band_id
      AND assigned_to = OLD.user_id;
  END IF;

  IF OLD.role = 'admin' THEN
    IF TG_OP = 'DELETE' THEN
      must_check_last_admin := TRUE;
    ELSE
      must_check_last_admin :=
        NEW.role <> 'admin'
        OR NEW.band_id IS DISTINCT FROM OLD.band_id;
    END IF;
  END IF;

  IF must_check_last_admin THEN
    PERFORM 1
    FROM public.bands AS b
    WHERE b.id = OLD.band_id
    FOR UPDATE;

    -- The parent row is absent during ON DELETE CASCADE from bands.
    IF NOT FOUND THEN
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END IF;

    SELECT count(*)
    INTO remaining_admins
    FROM public.band_members AS bm
    WHERE bm.band_id = OLD.band_id
      AND bm.role = 'admin'
      AND bm.id <> OLD.id;

    IF remaining_admins = 0 THEN
      RAISE EXCEPTION 'A band must retain at least one admin';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_last_band_admin_removal()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER band_members_prevent_last_admin_removal
BEFORE UPDATE OR DELETE ON public.band_members
FOR EACH ROW
EXECUTE FUNCTION private.prevent_last_band_admin_removal();

-- An assignee may edit a task but cannot take ownership or move it to another band.
CREATE OR REPLACE FUNCTION private.prevent_task_author_or_band_change()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $$
BEGIN
  IF (
    NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.band_id IS DISTINCT FROM OLD.band_id
  ) AND NOT private.is_band_admin(OLD.band_id) THEN
    RAISE EXCEPTION 'Only a band admin may change task author or band';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_task_author_or_band_change()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER tasks_prevent_author_or_band_change
BEFORE UPDATE ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION private.prevent_task_author_or_band_change();

CREATE OR REPLACE FUNCTION private.set_updated_at()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.set_updated_at()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER bands_set_updated_at
BEFORE UPDATE ON public.bands
FOR EACH ROW
EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER tasks_set_updated_at
BEFORE UPDATE ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER events_set_updated_at
BEFORE UPDATE ON public.events
FOR EACH ROW
EXECUTE FUNCTION private.set_updated_at();

ALTER TABLE public.bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.band_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- RLS controls which rows authenticated members may reach.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.bands,
  public.band_members,
  public.social_links,
  public.tasks,
  public.events
TO authenticated;

REVOKE ALL ON TABLE
  public.bands,
  public.band_members,
  public.social_links,
  public.tasks,
  public.events
FROM PUBLIC, anon, service_role;

CREATE POLICY bands_select_for_members
ON public.bands FOR SELECT TO authenticated
USING (private.is_band_member(id));

CREATE POLICY bands_insert_for_authenticated_users
ON public.bands FOR INSERT TO authenticated
WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY bands_update_for_admins
ON public.bands FOR UPDATE TO authenticated
USING (private.is_band_member(id) AND private.is_band_admin(id))
WITH CHECK (private.is_band_member(id) AND private.is_band_admin(id));

CREATE POLICY bands_delete_for_admins
ON public.bands FOR DELETE TO authenticated
USING (private.is_band_member(id) AND private.is_band_admin(id));

CREATE POLICY band_members_select_for_band_members
ON public.band_members FOR SELECT TO authenticated
USING (private.is_band_member(band_id));

CREATE POLICY band_members_insert_for_admins
ON public.band_members FOR INSERT TO authenticated
WITH CHECK (private.is_band_member(band_id) AND private.is_band_admin(band_id));

CREATE POLICY band_members_update_for_admins
ON public.band_members FOR UPDATE TO authenticated
USING (private.is_band_member(band_id) AND private.is_band_admin(band_id))
WITH CHECK (private.is_band_member(band_id) AND private.is_band_admin(band_id));

CREATE POLICY band_members_delete_for_admins
ON public.band_members FOR DELETE TO authenticated
USING (private.is_band_member(band_id) AND private.is_band_admin(band_id));

CREATE POLICY social_links_select_for_band_members
ON public.social_links FOR SELECT TO authenticated
USING (private.is_band_member(band_id));

CREATE POLICY social_links_insert_for_admins
ON public.social_links FOR INSERT TO authenticated
WITH CHECK (private.is_band_admin(band_id));

CREATE POLICY social_links_update_for_admins
ON public.social_links FOR UPDATE TO authenticated
USING (private.is_band_member(band_id) AND private.is_band_admin(band_id))
WITH CHECK (private.is_band_member(band_id) AND private.is_band_admin(band_id));

CREATE POLICY social_links_delete_for_admins
ON public.social_links FOR DELETE TO authenticated
USING (private.is_band_member(band_id) AND private.is_band_admin(band_id));

CREATE POLICY tasks_select_for_band_members
ON public.tasks FOR SELECT TO authenticated
USING (private.is_band_member(band_id));

CREATE POLICY tasks_insert_for_band_members
ON public.tasks FOR INSERT TO authenticated
WITH CHECK (
  private.is_band_member(band_id)
  AND (SELECT auth.uid()) IS NOT NULL
  AND created_by = (SELECT auth.uid())
  AND (
    assigned_to IS NULL
    OR private.is_band_member_for_user(band_id, assigned_to)
  )
);

CREATE POLICY tasks_update_for_admins_or_involved_members
ON public.tasks FOR UPDATE TO authenticated
USING (
  private.is_band_member(band_id)
  AND (
    private.is_band_admin(band_id)
    OR created_by = (SELECT auth.uid())
    OR assigned_to = (SELECT auth.uid())
  )
)
WITH CHECK (
  private.is_band_member(band_id)
  AND (
    assigned_to IS NULL
    OR private.is_band_member_for_user(band_id, assigned_to)
  )
  AND (
    private.is_band_admin(band_id)
    OR created_by = (SELECT auth.uid())
    OR assigned_to = (SELECT auth.uid())
  )
);

CREATE POLICY tasks_delete_for_admins_or_creators
ON public.tasks FOR DELETE TO authenticated
USING (
  private.is_band_member(band_id)
  AND (
    private.is_band_admin(band_id)
    OR created_by = (SELECT auth.uid())
  )
);

CREATE POLICY events_select_for_band_members
ON public.events FOR SELECT TO authenticated
USING (private.is_band_member(band_id));

CREATE POLICY events_insert_for_band_members
ON public.events FOR INSERT TO authenticated
WITH CHECK (
  private.is_band_member(band_id)
  AND (SELECT auth.uid()) IS NOT NULL
  AND created_by = (SELECT auth.uid())
);

CREATE POLICY events_update_for_admins_or_creators
ON public.events FOR UPDATE TO authenticated
USING (
  private.is_band_member(band_id)
  AND (
    private.is_band_admin(band_id)
    OR created_by = (SELECT auth.uid())
  )
)
WITH CHECK (
  private.is_band_member(band_id)
  AND (
    private.is_band_admin(band_id)
    OR created_by = (SELECT auth.uid())
  )
);

CREATE POLICY events_delete_for_admins_or_creators
ON public.events FOR DELETE TO authenticated
USING (
  private.is_band_member(band_id)
  AND (
    private.is_band_admin(band_id)
    OR created_by = (SELECT auth.uid())
  )
);
