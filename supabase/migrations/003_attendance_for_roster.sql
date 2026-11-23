-- Execute uma única vez no SQL Editor do Supabase.
-- Liga a chamada à turma cadastrada pelo professor.

alter table public.attendance drop constraint attendance_student_id_fkey;
alter table public.attendance add constraint attendance_student_id_fkey
  foreign key (student_id) references public.students(id) on delete cascade;

drop policy if exists "attendance: student sees own attendance" on public.attendance;
drop policy if exists "attendance: class teacher manages attendance" on public.attendance;

create policy "attendance: class teacher manages attendance" on public.attendance
  for all using (exists (
    select 1 from public.classes where classes.id = attendance.class_id and classes.teacher_id = auth.uid()
  )) with check (exists (
    select 1 from public.classes where classes.id = attendance.class_id and classes.teacher_id = auth.uid()
  ));
