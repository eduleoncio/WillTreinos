-- Will Treinos | Estrutura inicial
-- Execute uma única vez no SQL Editor do Supabase.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'student' check (role in ('teacher', 'student')),
  created_at timestamptz not null default now()
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null,
  created_at timestamptz not null default now()
);

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status text not null default 'present' check (status in ('present', 'absent', 'late')),
  created_at timestamptz not null default now(),
  unique (class_id, student_id)
);

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.students enable row level security;
alter table public.attendance enable row level security;

create policy "profiles: each user sees own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles: each user updates own profile" on public.profiles
  for update using (auth.uid() = id);
create policy "profiles: user creates own profile" on public.profiles
  for insert with check (auth.uid() = id);

create policy "classes: teacher manages own classes" on public.classes
  for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);
create policy "classes: authenticated users can view classes" on public.classes
  for select to authenticated using (true);
create policy "students: teacher manages own roster" on public.students
  for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

create policy "attendance: class teacher manages attendance" on public.attendance
  for all using (exists (
    select 1 from public.classes where classes.id = attendance.class_id and classes.teacher_id = auth.uid()
  )) with check (exists (
    select 1 from public.classes where classes.id = attendance.class_id and classes.teacher_id = auth.uid()
  ));

create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', 'Aluno'));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute procedure public.handle_new_user();

-- Após criar a conta do Willian, promova-a uma vez:
-- update public.profiles set role = 'teacher' where id = '<UUID_DO_WILLIAN>';
