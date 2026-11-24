-- Store student interest signals for upcoming classes without treating them as attendance.
create table if not exists public.class_session_interests (
  class_id uuid not null,
  student_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (class_id, student_id)
);

alter table public.class_session_interests enable row level security;

drop policy if exists "students manage own class interest" on public.class_session_interests;
create policy "students manage own class interest" on public.class_session_interests
  for all to authenticated
  using (student_id = auth.uid())
  with check (student_id = auth.uid());

drop policy if exists "staff read class interest" on public.class_session_interests;
create policy "staff read class interest" on public.class_session_interests
  for select to authenticated
  using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.role::text in ('teacher', 'admin', 'assistant')
  ));

create or replace function public.get_class_interest_counts(p_class_ids uuid[])
returns table (class_id uuid, interest_count bigint, interested boolean)
language sql
stable
security definer
set search_path = public
as $$
  select requested.class_id,
         count(interest.student_id) as interest_count,
         coalesce(bool_or(interest.student_id = auth.uid()), false) as interested
  from unnest(coalesce(p_class_ids, array[]::uuid[])) as requested(class_id)
  left join public.class_session_interests as interest on interest.class_id = requested.class_id
  group by requested.class_id;
$$;

grant execute on function public.get_class_interest_counts(uuid[]) to authenticated;
