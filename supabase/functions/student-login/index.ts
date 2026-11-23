import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function normalizeCpf(value: unknown) {
  return String(value || '').replace(/\D/g, '');
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
    const { cpf: rawCpf, password } = await request.json();
    const cpf = normalizeCpf(rawCpf);
    if (cpf.length !== 11 || !password) {
      return Response.json({ error: 'CPF ou senha inválidos.' }, { status: 401, headers: corsHeaders });
    }

    const admin = createClient(url, serviceKey);
    const { data: profile } = await admin.from('profiles').select('email').eq('cpf_hash', await hashCpf(cpf)).eq('role', 'student').maybeSingle();
    if (!profile?.email) return Response.json({ error: 'CPF ou senha inválidos.' }, { status: 401, headers: corsHeaders });

    const userClient = createClient(url, anonKey);
    const { data, error } = await userClient.auth.signInWithPassword({ email: profile.email, password: String(password) });
    if (error || !data.session) return Response.json({ error: 'CPF ou senha inválidos.' }, { status: 401, headers: corsHeaders });

    return Response.json({ session: data.session }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Não foi possível entrar.' }, { status: 400, headers: corsHeaders });
  }
});
