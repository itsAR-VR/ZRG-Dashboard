-- Phase 155c: Supabase Realtime RLS rollout for Lead + InboxCounts
-- Run in Supabase SQL editor (or psql) against the production project.
-- This script is idempotent for function/policy creation.

begin;

-- 1) Session-aware access predicate used by RLS policies.
create or replace function public.has_client_access(client_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public."Client" c
    where c.id = client_id
      and (
        c."userId" = auth.uid()::text
        or exists (
          select 1
          from public."ClientMember" cm
          where cm."clientId" = c.id
            and cm."userId" = auth.uid()::text
        )
      )
  );
$$;

-- Lock down execute privileges explicitly.
revoke all on function public.has_client_access(text) from public;
grant execute on function public.has_client_access(text) to authenticated, service_role;

-- 2) Enable RLS on tables used by browser read paths/realtime subscriptions.
alter table if exists public."Lead" enable row level security;
alter table if exists public."InboxCounts" enable row level security;

-- 3) Create SELECT policies if they do not already exist.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'Lead'
      and policyname = 'lead_select_workspace_access'
  ) then
    create policy lead_select_workspace_access
      on public."Lead"
      for select
      to authenticated
      using (public.has_client_access("clientId"));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'InboxCounts'
      and policyname = 'inbox_counts_select_workspace_access'
  ) then
    create policy inbox_counts_select_workspace_access
      on public."InboxCounts"
      for select
      to authenticated
      using (public.has_client_access("clientId"));
  end if;
end
$$;

commit;

-- 4) Post-rollout verification checks.
-- RLS enabled?
-- select relname, relrowsecurity
-- from pg_class
-- where relname in ('Lead', 'InboxCounts');
--
-- Policies present?
-- select schemaname, tablename, policyname, roles, cmd
-- from pg_policies
-- where tablename in ('Lead', 'InboxCounts')
-- order by tablename, policyname;
--
-- Realtime publication includes Lead?
-- select p.pubname, c.relname
-- from pg_publication p
-- join pg_publication_rel pr on pr.prpubid = p.oid
-- join pg_class c on c.oid = pr.prrelid
-- where p.pubname = 'supabase_realtime'
--   and c.relname = 'Lead';
