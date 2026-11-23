-- Execute uma única vez no SQL Editor do Supabase.
-- Alunos cadastrados pelo professor, sem necessidade de conta de acesso.

create table public.students (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null,
  created_at timestamptz not null default now()
);

alter table public.students enable row level security;

create policy "students: teacher manages own roster" on public.students
  for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);
