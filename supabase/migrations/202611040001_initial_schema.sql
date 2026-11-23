create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum ('admin', 'assistant', 'student');
create type public.absence_status as enum ('pending', 'approved', 'rejected');
create type public.event_status as enum ('draft', 'published', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  cpf_hash text unique,
  full_name text not null,
  role public.app_role not null default 'student',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  level text not null default 'Iniciante',
  age_group text not null default 'Adultos',
  location text not null,
  weekday smallint check (weekday between 0 and 6),
  starts_at time,
  ends_at time,
  capacity integer not null default 20 check (capacity > 0),
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.class_enrollments (
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  active boolean not null default true,
  primary key (class_id, student_id)
);

create table public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text not null,
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index class_sessions_starts_at_idx on public.class_sessions(starts_at);

create table public.attendance_qr_sessions (
  id uuid primary key default gen_random_uuid(),
  class_session_id uuid not null references public.class_sessions(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  expires_at timestamptz not null,
  closed_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  class_session_id uuid not null references public.class_sessions(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  source text not null default 'qr' check (source in ('qr', 'staff')),
  unique (class_session_id, student_id)
);
create index attendance_student_idx on public.attendance(student_id, checked_in_at desc);

create table public.absence_justifications (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  class_session_id uuid references public.class_sessions(id) on delete set null,
  absence_date date not null,
  reason text not null check (char_length(reason) between 5 and 2000),
  attachment_path text,
  status public.absence_status not null default 'pending',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index absences_student_date_idx on public.absence_justifications(student_id, absence_date desc);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  location text not null,
  starts_at timestamptz not null,
  registration_deadline timestamptz,
  status public.event_status not null default 'draft',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index events_upcoming_idx on public.events(starts_at) where status = 'published';

create table public.event_registrations (
  event_id uuid not null references public.events(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  registered_at timestamptz not null default now(),
  primary key (event_id, student_id)
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  audience text not null default 'all' check (audience in ('all', 'students', 'staff')),
  published_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  invited_role public.app_role not null check (invited_role in ('assistant', 'student')),
  invited_by uuid not null references public.profiles(id),
  auth_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create table public.staff_messages (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  sent_at timestamptz not null default now()
);
create index staff_messages_sent_at_idx on public.staff_messages(sent_at desc);

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'assistant')) $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

create or replace function public.create_profile_for_auth_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    case
      when new.raw_app_meta_data ->> 'role' = 'assistant' then 'assistant'::public.app_role
      when new.raw_app_meta_data ->> 'role' = 'admin' then 'admin'::public.app_role
      else 'student'::public.app_role
    end
  ) on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_profile_for_auth_user();

create or replace function public.create_attendance_qr(p_class_session_id uuid, p_valid_minutes integer default 90)
returns table (qr_session_id uuid, qr_token uuid, qr_expires_at timestamptz)
language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_token uuid; v_expiry timestamptz;
begin
  if not public.is_staff() then raise exception 'Apenas a equipe pode iniciar uma chamada.'; end if;
  if p_valid_minutes < 1 or p_valid_minutes > 180 then raise exception 'Validade inválida.'; end if;
  if not exists (select 1 from public.class_sessions s where s.id = p_class_session_id) then
    raise exception 'Aula não encontrada.';
  end if;
  v_token := gen_random_uuid();
  v_expiry := now() + make_interval(mins => p_valid_minutes);
  insert into public.attendance_qr_sessions(class_session_id, token, expires_at, created_by)
  values (p_class_session_id, v_token, v_expiry, auth.uid()) returning id into v_id;
  return query select v_id, v_token, v_expiry;
end;
$$;

create or replace function public.check_in_with_qr(p_token uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_qr public.attendance_qr_sessions%rowtype; v_attendance_id uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'student') then
    raise exception 'Entre com uma conta de aluno para registrar presença.';
  end if;
  select * into v_qr from public.attendance_qr_sessions
   where token = p_token and closed_at is null and expires_at > now();
  if not found then raise exception 'Este QR Code expirou ou foi encerrado.'; end if;
  if not exists (
    select 1 from public.class_sessions s
    join public.class_enrollments e on e.class_id = s.class_id
    where s.id = v_qr.class_session_id and e.student_id = auth.uid() and e.active
  ) then raise exception 'Sua conta não está inscrita nesta turma.'; end if;
  insert into public.attendance(class_session_id, student_id, source)
  values (v_qr.class_session_id, auth.uid(), 'qr')
  on conflict (class_session_id, student_id) do nothing
  returning id into v_attendance_id;
  if v_attendance_id is null then raise exception 'Sua presença nesta aula já foi registrada.'; end if;
  return v_attendance_id;
end;
$$;

create or replace function public.close_attendance_qr(p_qr_session_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'Apenas a equipe pode encerrar a chamada.'; end if;
  update public.attendance_qr_sessions set closed_at = now()
   where id = p_qr_session_id and created_by = auth.uid() and closed_at is null;
  if not found then raise exception 'Chamada não encontrada ou já encerrada.'; end if;
end;
$$;

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.class_enrollments enable row level security;
alter table public.class_sessions enable row level security;
alter table public.attendance_qr_sessions enable row level security;
alter table public.attendance enable row level security;
alter table public.absence_justifications enable row level security;
alter table public.events enable row level security;
alter table public.event_registrations enable row level security;
alter table public.announcements enable row level security;
alter table public.staff_invites enable row level security;
alter table public.staff_messages enable row level security;

create policy "profiles_read_self_or_staff" on public.profiles for select to authenticated
using (id = auth.uid() or public.is_staff());
create policy "classes_read_authenticated" on public.classes for select to authenticated using (active or public.is_staff());
create policy "classes_staff_manage" on public.classes for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "enrollments_read_self_or_staff" on public.class_enrollments for select to authenticated
using (student_id = auth.uid() or public.is_staff());
create policy "enrollments_staff_manage" on public.class_enrollments for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "sessions_read_enrolled_or_staff" on public.class_sessions for select to authenticated
using (public.is_staff() or exists (select 1 from public.class_enrollments e where e.class_id = class_sessions.class_id and e.student_id = auth.uid() and e.active));
create policy "sessions_staff_manage" on public.class_sessions for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "qr_sessions_staff_read" on public.attendance_qr_sessions for select to authenticated using (public.is_staff());
create policy "attendance_read_self_or_staff" on public.attendance for select to authenticated using (student_id = auth.uid() or public.is_staff());
create policy "attendance_staff_manage" on public.attendance for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "absence_read_self_or_staff" on public.absence_justifications for select to authenticated using (student_id = auth.uid() or public.is_staff());
create policy "absence_student_create" on public.absence_justifications for insert to authenticated with check (student_id = auth.uid());
create policy "absence_staff_review" on public.absence_justifications for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "events_read_published_or_staff" on public.events for select to authenticated using (status = 'published' or public.is_staff());
create policy "events_staff_manage" on public.events for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "event_registrations_read_self_or_staff" on public.event_registrations for select to authenticated using (student_id = auth.uid() or public.is_staff());
create policy "event_registrations_student_register" on public.event_registrations for insert to authenticated with check (student_id = auth.uid() and exists (select 1 from public.events where id = event_id and status = 'published'));
create policy "event_registrations_student_cancel" on public.event_registrations for delete to authenticated using (student_id = auth.uid());
create policy "announcements_read_audience" on public.announcements for select to authenticated
using (public.is_staff() or (published_at is not null and audience in ('all', 'students')));
create policy "announcements_staff_manage" on public.announcements for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "staff_invites_admin_read" on public.staff_invites for select to authenticated using (public.is_admin());
create policy "staff_messages_staff_read" on public.staff_messages for select to authenticated using (public.is_staff());
create policy "staff_messages_staff_send" on public.staff_messages for insert to authenticated with check (public.is_staff() and author_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('absence-attachments', 'absence-attachments', false, 10485760, array['image/jpeg','image/png','application/pdf'])
on conflict (id) do nothing;

create policy "students_upload_own_absence_files" on storage.objects for insert to authenticated
with check (bucket_id = 'absence-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "students_read_own_or_staff_absence_files" on storage.objects for select to authenticated
using (bucket_id = 'absence-attachments' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff()));

grant execute on function public.create_attendance_qr(uuid, integer) to authenticated;
grant execute on function public.check_in_with_qr(uuid) to authenticated;
grant execute on function public.close_attendance_qr(uuid) to authenticated;
