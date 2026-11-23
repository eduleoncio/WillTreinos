import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function normalizeCpf(value: unknown) {
  return String(value || '').replace(/\D/g, '');
}

function isValidCpf(value: string) {
  if (value.length !== 11 || /^([0-9])\1+$/.test(value)) return false;
  const digit = (length: number) => {
    const sum = value.slice(0, length).split('').reduce((total, number, index) => total + Number(number) * (length + 1 - index), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9) === Number(value[9]) && digit(10) === Number(value[10]);
}

async function hashCpf(cpf: string) {
  const secret = Deno.env.get('CPF_HASH_SECRET');
  if (!secret) throw new Error('Configure CPF_HASH_SECRET nas funções do Supabase.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(cpf));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authorization = request.headers.get('Authorization');
    if (!authorization) return Response.json({ error: 'Entre novamente para continuar.' }, { status: 401, headers: corsHeaders });

    const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const admin = createClient(url, serviceKey);
    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();
    if (authError || !caller) return Response.json({ error: 'Sessão inválida.' }, { status: 401, headers: corsHeaders });

    const { data: profile } = await admin.from('profiles').select('role').eq('id', caller.id).single();
    if (profile?.role !== 'admin') return Response.json({ error: 'Somente o administrador pode enviar convites.' }, { status: 403, headers: corsHeaders });

    const { email, fullName, role, classId, cpf: rawCpf } = await request.json();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedName = String(fullName || '').trim();
    if (!normalizedEmail || !normalizedName || !['assistant', 'student'].includes(role)) {
      return Response.json({ error: 'Informe nome, e-mail e tipo de acesso.' }, { status: 400, headers: corsHeaders });
    }

    let cpfHash: string | null = null;
    if (role === 'student') {
      const cpf = normalizeCpf(rawCpf);
      if (!isValidCpf(cpf)) return Response.json({ error: 'Informe um CPF válido para o aluno.' }, { status: 400, headers: corsHeaders });
      cpfHash = await hashCpf(cpf);
      const { data: existingCpf } = await admin.from('profiles').select('id').eq('cpf_hash', cpfHash).maybeSingle();
      if (existingCpf) return Response.json({ error: 'Já existe um cadastro com este CPF.' }, { status: 409, headers: corsHeaders });
    }

    const { data: invite, error: inviteError } = await admin.auth.admin.inviteUserByEmail(normalizedEmail, {
      data: { full_name: normalizedName },
      redirectTo: `${request.headers.get('origin') || url}/`,
    });
    if (inviteError || !invite.user) throw inviteError || new Error('Não foi possível criar o convite.');

    const { error: roleError } = await admin.auth.admin.updateUserById(invite.user.id, {
      app_metadata: { role },
    });
    if (roleError) throw roleError;

    const { error: profileError } = await admin.from('profiles').upsert({
      id: invite.user.id,
      email: normalizedEmail,
      full_name: normalizedName,
      role,
      cpf_hash: cpfHash,
    });
    if (profileError) throw profileError;

    if (role === 'student' && classId) {
      const { error: enrollmentError } = await admin.from('class_enrollments').upsert({ class_id: classId, student_id: invite.user.id });
      if (enrollmentError) throw enrollmentError;
    }

    const { error: logError } = await admin.from('staff_invites').insert({
      email: normalizedEmail,
      invited_role: role,
      invited_by: caller.id,
      auth_user_id: invite.user.id,
    });
    if (logError) throw logError;

    return Response.json({ ok: true, invitedEmail: normalizedEmail }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Erro ao enviar convite.' }, { status: 400, headers: corsHeaders });
  }
});
