-- Execute uma única vez no SQL Editor do Supabase.
-- Permite que cada pessoa autenticada tenha seu próprio perfil criado pelo app.

create policy "profiles: user creates own profile" on public.profiles
  for insert with check (auth.uid() = id);
