create type public.project_role as enum ('admin', 'member');
create type public.task_priority as enum ('low', 'medium', 'high', 'critical');
create type public.task_status as enum ('todo', 'in_progress', 'review', 'completed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role public.project_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 1000),
  deadline date not null,
  color text not null default '#ff715b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  assigned_to uuid references public.profiles(id) on delete set null,
  assignee_name text not null default '' check (char_length(assignee_name) <= 100),
  priority public.task_priority not null default 'medium',
  deadline date not null,
  status public.task_status not null default 'todo',
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_owner_id_idx on public.projects(owner_id);
create index projects_deadline_idx on public.projects(deadline);
create index tasks_project_status_position_idx on public.tasks(project_id, status, position);
create index tasks_owner_id_idx on public.tasks(owner_id);
create index tasks_deadline_open_idx on public.tasks(deadline) where status <> 'completed';
create index tasks_assigned_to_idx on public.tasks(assigned_to) where assigned_to is not null;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger projects_set_updated_at before update on public.projects
for each row execute function private.set_updated_at();
create trigger tasks_set_updated_at before update on public.tasks
for each row execute function private.set_updated_at();

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;

create policy "profiles_select_own"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

create policy "profiles_update_own"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "projects_select_own"
on public.projects for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "projects_insert_own"
on public.projects for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy "projects_update_own"
on public.projects for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "projects_delete_own"
on public.projects for delete
to authenticated
using ((select auth.uid()) = owner_id);

create policy "tasks_select_own"
on public.tasks for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "tasks_insert_own_project"
on public.tasks for insert
to authenticated
with check (
  (select auth.uid()) = owner_id
  and exists (
    select 1 from public.projects
    where projects.id = tasks.project_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "tasks_update_own"
on public.tasks for update
to authenticated
using ((select auth.uid()) = owner_id)
with check (
  (select auth.uid()) = owner_id
  and exists (
    select 1 from public.projects
    where projects.id = tasks.project_id
      and projects.owner_id = (select auth.uid())
  )
);

create policy "tasks_delete_own"
on public.tasks for delete
to authenticated
using ((select auth.uid()) = owner_id);

grant usage on schema public to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;

alter publication supabase_realtime add table public.projects;
alter publication supabase_realtime add table public.tasks;
