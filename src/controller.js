import QRCode from 'qrcode';
import { backendConfigured, supabase } from './lib/supabase.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const demoNotices = [
  { id: 'demo-notice-1', title: 'Boas-vindas ao Will Treinos', body: 'Este espaço reúne avisos, horários e atividades das aulas.', published_at: new Date().toISOString(), audience: 'all' },
  { id: 'demo-notice-2', title: 'O que trazer para a aula', body: 'Venha com roupas confortáveis e traga uma garrafa de água.', published_at: new Date().toISOString(), audience: 'students' },
];
const demoEventsFallback = [
  { id: 'demo-event-1', title: 'Manhã de vôlei no Ouro Verde', description: 'Encontro amistoso para as turmas do projeto. Traga sua garrafa de água e venha jogar com a gente.', location: 'Quadra comunitária do Ouro Verde', starts_at: '2026-11-21T09:00:00-03:00', status: 'published' },
];

export function initController(app) {
  const { students, addedStudents, demoInvites, setCurrentUser, renderStaff, escapeHtml, initials } = app;
  const appShell = $('#app-shell');
  const authScreen = $('#auth-screen');
  const sidebar = $('#sidebar');
  const menuButton = $('#mobile-menu');
  const sidebarBackdrop = $('#sidebar-backdrop');
  const content = $('#content');
  const toast = $('#toast');
  let role = 'staff';
  let user = null;
  let authRole = 'staff';
  let view = 'inicio';
  let timer;
  const themeButtons = $$('.theme-toggle');
  const themeIcons = {
    system: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M7 8h10M7 11h6"/>',
    dark: '<path d="M20.4 15.5A8.5 8.5 0 0 1 8.5 3.6 8.6 8.6 0 1 0 20.4 15.5Z"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>'
  };
  const themeModes = ['system', 'dark', 'light'];
  const themeLabels = { system: 'automático', dark: 'escuro', light: 'claro' };
  let themePreference = localStorage.getItem('will-treinos-theme') || 'system';
  function applyTheme(preference, persist = false) {
    themePreference = themeModes.includes(preference) ? preference : 'system';
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const resolvedTheme = themePreference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : themePreference;
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themePreference = themePreference;
    themeButtons.forEach((button) => {
      const icon = button.querySelector('svg');
      if (icon) icon.innerHTML = themeIcons[themePreference];
      button.setAttribute('aria-label', `Tema ${themeLabels[themePreference]}`);
      button.title = `Tema ${themeLabels[themePreference]} · clique para alterar`;
      button.setAttribute('aria-pressed', String(themePreference === 'dark'));
    });
    if (persist) localStorage.setItem('will-treinos-theme', themePreference);
  }
  applyTheme(themePreference);
  themeButtons.forEach((button) => button.addEventListener('click', () => {
    const nextMode = themeModes[(themeModes.indexOf(themePreference) + 1) % themeModes.length];
    applyTheme(nextMode, true);
  }));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (themePreference === 'system') applyTheme('system');
  });
  let qrSession = null;
  let qrToken = null;
  let profileSearchTimer;
  let profileSearchRequest = 0;
  let selectedProfile = null;
  let events = [...(app.eventCache || []), ...demoEventsFallback];
  let absences = app.absenceCache || [];
  let attendances = JSON.parse(localStorage.getItem('will-demo-attendance') || '[]');
  let notices = [...demoNotices];
  let messages = JSON.parse(localStorage.getItem('will-treinos-messages') || '[]');

  function toastMessage(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => toast.classList.remove('show'), 3400);
  }

  function dateText(value, options = { day: '2-digit', month: 'short', year: 'numeric' }) {
    return new Intl.DateTimeFormat('pt-BR', options).format(new Date(value));
  }

  function toggleSidebar(open) {
    sidebar.classList.toggle('open', open);
    sidebarBackdrop.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('navigation-open', open);
    if (open) sidebar.querySelector('[data-view]:not([hidden])')?.focus();
    else if (window.matchMedia('(max-width: 820px)').matches) menuButton.focus({ preventScroll: true });
  }

  function showAuth(message = '') {
    appShell.hidden = true;
    authScreen.hidden = false;
    $('#demo-access').hidden = backendConfigured;
    $('#login-form').hidden = !backendConfigured;
    $('#auth-error').textContent = message;
    $('#auth-title').textContent = sessionStorage.getItem('will-pending-qr')
      ? 'Entre para confirmar sua presença.'
      : 'A comunidade começa aqui.';
  }

  function selectAuthRole(nextRole) {
    authRole = nextRole;
    $$('[data-auth-role]').forEach((button) => {
      const active = button.dataset.authRole === nextRole;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    const identifier = $('#login-email');
    $('#login-email-label').textContent = nextRole === 'student' ? 'CPF do aluno' : 'E-mail da equipe';
    identifier.type = nextRole === 'student' ? 'text' : 'email';
    identifier.inputMode = nextRole === 'student' ? 'numeric' : 'email';
    identifier.placeholder = nextRole === 'student' ? '000.000.000-00' : 'seu@email.com';
  }

  function eventList() {
    return events.filter((item) => item.status === 'published' && new Date(item.starts_at) > new Date())
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  }

  function eventCard(item, compact = false) {
    const when = dateText(item.starts_at, { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `<article class="student-event-card"><span class="event-label">${escapeHtml(when)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description || 'Atividade da comunidade Will Treinos.')}</p><div class="student-event-meta"><span>${escapeHtml(item.location || 'Ouro Verde · Campinas')}</span>${compact ? '' : `<button class="button ${item.registered ? 'button-light' : 'button-primary'}" data-action="register-event" data-event-id="${escapeHtml(item.id)}">${item.registered ? 'Cancelar inscrição' : 'Quero participar'}</button>`}</div></article>`;
  }

  function renderStudentHome() {
    const firstName = escapeHtml((user?.full_name || 'Aluno').split(' ')[0]);
    const nextEvent = eventList()[0];
    return `<div class="page-heading"><div><span class="eyebrow">ÁREA DO ALUNO</span><h1>Olá, ${firstName} 👋</h1><p>Acompanhe suas aulas e participe das atividades do projeto.</p></div></div><section class="student-home-hero"><span class="eyebrow">WILL TREINOS · OURO VERDE</span><h2>Seu espaço para jogar,<br>aprender e crescer junto.</h2><p>As informações da sua turma e da comunidade ficam reunidas aqui.</p></section><section class="stats-grid"><article class="stat-card"><div class="stat-top">Presenças registradas</div><div class="stat-value-row"><strong class="stat-value">${attendances.length || '—'}</strong></div><div class="stat-foot">Confira seu histórico</div></article><article class="stat-card"><div class="stat-top">Próximos campeonatos</div><div class="stat-value-row"><strong class="stat-value">${eventList().length}</strong></div><div class="stat-foot">Atividades abertas à comunidade</div></article></section><section class="section-grid"><article class="panel"><h3 class="panel-title">Sua próxima aula</h3><p class="panel-subtitle">A presença é registrada ao escanear o QR Code exibido pelo professor.</p><div class="attendance-callout">Quando o professor iniciar a chamada, abra a câmera do celular e aponte para o QR Code. Você precisa estar conectado à sua conta.</div><div class="class-actions"><button class="button button-primary" data-action="view" data-target="aluno-presenca">Ver minhas presenças <span>↗</span></button></div></article><article class="panel"><h3 class="panel-title">Próximo campeonato</h3>${nextEvent ? eventCard(nextEvent, true) : '<div class="empty-friendly">Ainda não há campeonatos publicados.</div>'}<button class="panel-link" data-action="view" data-target="aluno-campeonatos">Ver todos →</button></article></section>`;
  }

  function renderStudentAttendance() {
    const rows = attendances.map((item) => `<div class="student-absence-card"><strong>Presença confirmada</strong><p>${dateText(item.checked_in_at)} · Aula ${escapeHtml(String(item.class_session_id || '').slice(0, 8))}</p></div>`).join('');
    const waiting = sessionStorage.getItem('will-pending-qr');
    return `<div class="page-heading"><div><span class="eyebrow">PORTAL DO ALUNO</span><h1>Minhas presenças</h1><p>Acompanhe as chamadas registradas nas suas aulas.</p></div></div><section class="panel"><div class="panel-head"><div><h3 class="panel-title">Registrar entrada</h3><div class="panel-subtitle">Escaneie com a câmera do celular o QR Code exibido pelo professor.</div></div></div>${waiting ? '<div class="attendance-callout">QR Code reconhecido. Confirme para registrar sua entrada.</div><div class="class-actions"><button class="button button-primary" data-action="check-in">Confirmar presença <span>↗</span></button></div>' : '<div class="empty-friendly">Nenhuma chamada aberta no momento. Peça ao professor para exibir o código da aula.</div>'}</section><section class="panel" style="margin-top:14px"><h3 class="panel-title">Histórico de presenças</h3>${rows || '<div class="empty-friendly">Suas presenças registradas aparecerão aqui.</div>'}</section>`;
  }

  function renderStudentAbsences() {
    const rows = absences.map((item) => `<div class="student-absence-card"><strong>${dateText(item.absence_date, { day: '2-digit', month: 'long', year: 'numeric' })}</strong><p>${escapeHtml(item.reason)}</p><span class="presence-pill ${item.status === 'pending' ? 'low' : ''}">${item.status === 'pending' ? 'Aguardando análise' : item.status === 'approved' ? 'Justificativa aceita' : 'Justificativa não aceita'}</span>${item.attachment_path ? '<span class="muted"> · Anexo enviado</span>' : ''}</div>`).join('');
    return `<div class="page-heading"><div><span class="eyebrow">PORTAL DO ALUNO</span><h1>Justificativas</h1><p>Envie o motivo da falta. Você pode anexar um comprovante, se quiser.</p></div><button class="button button-primary" data-action="new-absence">＋ <span>Justificar falta</span></button></div><section class="panel"><h3 class="panel-title">Minhas solicitações</h3><p class="panel-subtitle">A equipe do projeto poderá analisar cada envio.</p>${rows || '<div class="empty-friendly">Você ainda não enviou justificativas.</div>'}</section>`;
  }

  function renderStudentEvents() {
    const upcoming = eventList();
    return `<div class="page-heading"><div><span class="eyebrow">PORTAL DO ALUNO</span><h1>Campeonatos e encontros</h1><p>Veja as próximas atividades e confirme sua participação.</p></div></div><section class="panel"><div class="panel-head"><div><h3 class="panel-title">Próximas atividades</h3><div class="panel-subtitle">Eventos publicados pela equipe</div></div></div><div class="student-card-list">${upcoming.map((item) => eventCard(item)).join('') || '<div class="empty-friendly">Nenhum campeonato ou encontro publicado por enquanto.</div>'}</div></section>`;
  }

  function renderStudentNotices() {
    const rows = notices.map((item) => `<div class="notice-item"><span class="event-label">${dateText(item.published_at, { day: '2-digit', month: 'long' })}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p></div>`).join('');
    return `<div class="page-heading"><div><span class="eyebrow">PORTAL DO ALUNO</span><h1>Avisos</h1><p>Comunicados importantes da equipe do Will Treinos.</p></div></div><section class="panel">${rows || '<div class="empty-friendly">Nenhum aviso novo.</div>'}</section>`;
  }

  function renderStudentProfile() {
    return `<div class="page-heading"><div><span class="eyebrow">PORTAL DO ALUNO</span><h1>Meu perfil</h1><p>Confira os dados da sua conta.</p></div></div><section class="panel"><div class="profile-row"><span class="avatar">${initials(user?.full_name || 'Aluno')}</span><div><strong>${escapeHtml(user?.full_name || 'Aluno')}</strong><small>${escapeHtml(user?.email || 'Conta de demonstração')}</small></div></div><div class="attendance-callout">Para alterar seu e-mail ou redefinir a senha, use as opções de recuperação enviadas ao e-mail cadastrado.</div><button class="button button-light" data-action="logout">Sair da conta</button></section>`;
  }

  function closePeopleSearch() {
    $('#people-search-results').hidden = true;
    $('#people-search').setAttribute('aria-expanded', 'false');
  }

  function renderPeopleSearch(items, query, message = '') {
    const results = $('#people-search-results');
    if (message) {
      results.innerHTML = `<div class="people-search-message">${escapeHtml(message)}</div>`;
    } else if (!items.length) {
      results.innerHTML = `<div class="people-search-message">Ninguém encontrado para “${escapeHtml(query)}”.</div>`;
    } else {
      results.innerHTML = `<div class="people-search-caption">PESSOAS CADASTRADAS</div>${items.map((person) => `<button type="button" class="people-search-result" role="option" data-person-profile="${escapeHtml(person.id)}"><span class="person-search-avatar">${escapeHtml(initials(person.full_name || '?'))}</span><span class="person-search-copy"><strong>${escapeHtml(person.full_name)}</strong><small>${escapeHtml(person.email || 'E-mail não informado')}</small></span><span class="person-search-role ${person.role === 'student' ? 'is-student' : ''}">${person.role === 'student' ? 'Aluno' : person.role === 'admin' ? 'Administrador' : 'Equipe'}</span></button>`).join('')}${items.length === 8 ? '<div class="people-search-message">Mostrando 8 resultados. Refine a pesquisa para encontrar mais pessoas.</div>' : ''}`;
    }
    results.hidden = false;
    $('#people-search').setAttribute('aria-expanded', 'true');
  }

  async function searchPeople(rawQuery) {
    const query = rawQuery.trim().replace(/[,%()]/g, ' ');
    const requestId = ++profileSearchRequest;
    if (role !== 'staff') return;
    if (!supabase) {
      renderPeopleSearch([], query, 'A pesquisa de pessoas fica disponível após conectar o Supabase.');
      return;
    }
    if (query.length < 2) {
      if (query.length) renderPeopleSearch([], query, 'Digite pelo menos 2 caracteres.');
      else closePeopleSearch();
      return;
    }
    renderPeopleSearch([], query, 'Buscando pessoas…');
    const { data, error } = await supabase.from('profiles')
      .select('id,email,full_name,role,created_at')
      .or(`full_name.ilike.%${query}%,email.ilike.%${query}%`)
      .order('full_name').limit(8);
    if (requestId !== profileSearchRequest) return;
    if (error) {
      renderPeopleSearch([], query, 'Não foi possível pesquisar agora. Verifique as permissões do Supabase.');
      return;
    }
    renderPeopleSearch(data || [], query);
  }

  function renderPersonProfile(profile, classes = [], attendanceCount = 0) {
    const roleName = profile.role === 'student' ? 'Aluno' : profile.role === 'admin' ? 'Administrador' : 'Equipe';
    const since = profile.created_at ? dateText(profile.created_at, { day: '2-digit', month: 'long', year: 'numeric' }) : 'Não informado';
    const classRows = classes.length
      ? classes.map((item) => `<div class="profile-class-row"><span class="profile-class-icon">◫</span><span><strong>${escapeHtml(item.class?.name || 'Turma')}</strong><small>${escapeHtml(item.class?.level || '')}${item.class?.age_group ? ` · ${escapeHtml(item.class.age_group)}` : ''}</small></span><span class="presence-pill">${item.active ? 'Ativa' : 'Inativa'}</span></div>`).join('')
      : '<div class="empty-friendly">Nenhuma turma vinculada.</div>';
    const studentSections = profile.role === 'student'
      ? `<section class="panel profile-panel"><h2 class="panel-title">Participação nas aulas</h2><div class="profile-stats"><div><strong>${attendanceCount}</strong><span>presenças registradas</span></div><div><strong>${classes.filter((item) => item.active).length}</strong><span>turmas ativas</span></div></div><h3 class="profile-subheading">Turmas</h3>${classRows}</section>`
      : `<section class="panel profile-panel"><h2 class="panel-title">Acesso ao sistema</h2><div class="profile-detail-row"><span>Tipo de acesso</span><strong>${roleName}</strong></div><div class="profile-detail-row"><span>Situação</span><strong>Conta cadastrada</strong></div></section>`;
    content.innerHTML = `<div class="page-heading profile-page-heading"><div><span class="eyebrow">PERFIL ${profile.role === 'student' ? 'DO ALUNO' : 'DA EQUIPE'}</span><h1>${escapeHtml(profile.full_name || 'Pessoa cadastrada')}</h1><p>Informações disponíveis no cadastro do Will Treinos.</p></div><button class="button button-light" data-action="back-to-people">← Voltar à busca</button></div><section class="panel profile-hero"><span class="profile-large-avatar">${escapeHtml(initials(profile.full_name || '?'))}</span><div class="profile-hero-copy"><span class="presence-pill ${profile.role === 'student' ? '' : 'profile-staff-pill'}">${roleName}</span><h2>${escapeHtml(profile.full_name || 'Pessoa cadastrada')}</h2><p>${escapeHtml(profile.email || 'E-mail não informado')}</p></div></section><div class="profile-layout"><section class="panel profile-panel"><h2 class="panel-title">Dados do perfil</h2><div class="profile-detail-row"><span>Nome</span><strong>${escapeHtml(profile.full_name || 'Não informado')}</strong></div><div class="profile-detail-row"><span>E-mail</span><strong>${escapeHtml(profile.email || 'Não informado')}</strong></div><div class="profile-detail-row"><span>Perfil</span><strong>${roleName}</strong></div><div class="profile-detail-row"><span>Desde</span><strong>${escapeHtml(since)}</strong></div></section>${studentSections}</div>`;
  }

  async function openPersonProfile(profileId) {
    closePeopleSearch();
    $('#people-search').value = '';
    if (!supabase || role !== 'staff') return;
    const { data: profile, error } = await supabase.from('profiles').select('id,email,full_name,role,created_at').eq('id', profileId).maybeSingle();
    if (error || !profile) { toastMessage('Não foi possível abrir esse perfil.'); return; }
    selectedProfile = profile;
    view = 'perfil-pessoa';
    render();
    if (profile.role !== 'student') return;
    const [enrollmentResult, attendanceResult] = await Promise.all([
      supabase.from('class_enrollments').select('active,class:classes(name,level,age_group)').eq('student_id', profile.id).order('enrolled_at', { ascending: false }),
      supabase.from('attendance').select('id', { count: 'exact', head: true }).eq('student_id', profile.id),
    ]);
    if (view === 'perfil-pessoa' && selectedProfile?.id === profile.id) renderPersonProfile(profile, enrollmentResult.data || [], attendanceResult.count || 0);
  }

  function render() {
    $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
    if (role === 'student') {
      const labels = { 'aluno-inicio': 'Meu espaço', 'aluno-presenca': 'Minhas presenças', 'aluno-faltas': 'Justificativas', 'aluno-campeonatos': 'Campeonatos', 'aluno-avisos': 'Avisos', 'aluno-perfil': 'Meu perfil' };
      $('#breadcrumb-current').textContent = labels[view] || labels['aluno-inicio'];
      const views = { 'aluno-inicio': renderStudentHome, 'aluno-presenca': renderStudentAttendance, 'aluno-faltas': renderStudentAbsences, 'aluno-campeonatos': renderStudentEvents, 'aluno-avisos': renderStudentNotices, 'aluno-perfil': renderStudentProfile };
      content.innerHTML = (views[view] || renderStudentHome)();
    } else {
      if (view === 'perfil-pessoa' && selectedProfile) {
        $('#breadcrumb-current').textContent = selectedProfile.full_name;
        renderPersonProfile(selectedProfile);
      } else renderStaff(view);
      const activeTotal = $('#active-total');
      if (activeTotal) activeTotal.textContent = students.length;
    }
  }

  async function loadStaffStudents() {
    const { data, error } = await supabase.from('profiles').select('id,email,full_name,role').eq('role', 'student').order('full_name');
    if (error) { toastMessage(`Não foi possível carregar alunos: ${error.message}`); return; }
    students.splice(0, students.length, ...data.map((item) => ({ id: item.id, email: item.email, name: item.full_name, group: 'Aluno', className: '—', presence: '—', initials: initials(item.full_name) })));
    render();
  }

  async function loadStudentData() {
    const [eventResult, absenceResult, attendanceResult, noticeResult, registrationResult] = await Promise.all([
      supabase.from('events').select('id,title,description,location,starts_at,status').eq('status', 'published').gte('starts_at', new Date().toISOString()).order('starts_at'),
      supabase.from('absence_justifications').select('id,absence_date,reason,attachment_path,status,created_at').eq('student_id', user.id).order('absence_date', { ascending: false }),
      supabase.from('attendance').select('id,checked_in_at,class_session_id').eq('student_id', user.id).order('checked_in_at', { ascending: false }),
      supabase.from('announcements').select('id,title,body,published_at,audience').not('published_at', 'is', null).order('published_at', { ascending: false }),
      supabase.from('event_registrations').select('event_id').eq('student_id', user.id),
    ]);
    if (!eventResult.error) events = eventResult.data.map((event) => ({ ...event, registered: (registrationResult.data || []).some((item) => item.event_id === event.id) }));
    if (!absenceResult.error) absences = absenceResult.data;
    if (!attendanceResult.error) attendances = attendanceResult.data;
    if (!noticeResult.error) notices = noticeResult.data.filter((item) => ['all', 'students'].includes(item.audience));
    render();
  }

  function openDialog(selector, focus) {
    const dialog = $(selector);
    dialog.hidden = false;
    document.body.classList.add('modal-open');
    if (focus) setTimeout(() => dialog.querySelector(focus)?.focus(), 50);
  }

  function closeDialog(selector) {
    const dialog = $(selector);
    if (dialog) dialog.hidden = true;
    if (!$('.modal-backdrop:not([hidden])')) document.body.classList.remove('modal-open');
  }

  function closeAllDialogs() {
    $$('.modal-backdrop:not([hidden])').forEach((dialog) => { dialog.hidden = true; });
    document.body.classList.remove('modal-open');
  }

  async function login(event) {
    event.preventDefault();
    if (!supabase) { toastMessage('Conecte o Supabase para usar o login real.'); return; }
    const values = new FormData(event.currentTarget);
    const identifier = String(values.get('email')).trim();
    $('#auth-error').textContent = 'Verificando acesso…';
    let data;
    let error;
    if (authRole === 'student') {
      const response = await supabase.functions.invoke('student-login', { body: { cpf: identifier, password: String(values.get('password')) } });
      error = response.error;
      if (!error && response.data?.session) {
        const sessionResult = await supabase.auth.setSession({ access_token: response.data.session.access_token, refresh_token: response.data.session.refresh_token });
        data = { user: sessionResult.data.user };
        error = sessionResult.error;
      }
    } else {
      const response = await supabase.auth.signInWithPassword({ email: identifier.toLowerCase(), password: String(values.get('password')) });
      data = response.data;
      error = response.error;
    }
    if (error || !data?.user) { $('#auth-error').textContent = authRole === 'student' ? 'CPF ou senha inválidos.' : 'E-mail ou senha inválidos.'; return; }
    const { data: profile, error: profileError } = await supabase.from('profiles').select('id,email,full_name,role').eq('id', data.user.id).single();
    if (profileError || !profile) {
      await supabase.auth.signOut();
      $('#auth-error').textContent = 'Seu perfil ainda não está liberado. Peça um convite ao administrador.';
      return;
    }
    const wrongPortal = (authRole === 'student' && profile.role !== 'student') || (authRole === 'staff' && profile.role === 'student');
    if (wrongPortal) {
      await supabase.auth.signOut();
      $('#auth-error').textContent = authRole === 'student' ? 'Esta conta pertence ao portal da equipe.' : 'Esta conta pertence ao portal do aluno.';
      return;
    }
    openPortal(profile.role === 'student' ? 'student' : 'staff', data.user, profile);
  }

  function openPortal(nextRole, authUser, profile = null) {
    role = nextRole;
    user = { ...(authUser || {}), ...(profile || {}), full_name: profile?.full_name || authUser?.user_metadata?.full_name || authUser?.full_name || (nextRole === 'student' ? 'Aluno' : 'Willian') };
    setCurrentUser(user);
    view = nextRole === 'student' ? 'aluno-inicio' : 'inicio';
    authScreen.hidden = true;
    appShell.hidden = false;
    $('#staff-nav').hidden = nextRole === 'student';
    $('#student-nav').hidden = nextRole !== 'student';
    $('#people-search-wrap').hidden = nextRole !== 'staff';
    closePeopleSearch();
    $('#workspace-label').textContent = nextRole === 'student' ? 'PORTAL DO ALUNO' : 'ESPAÇO DO PROJETO';
    $('#profile-name').textContent = user.full_name;
    $('#profile-role').textContent = nextRole === 'student' ? 'Aluno' : 'Professor · administrador';
    $('.avatar-w').textContent = initials(user.full_name);
    toggleSidebar(false);
    render();
    if (supabase && nextRole === 'staff') void loadStaffStudents();
    if (supabase && nextRole === 'student') void loadStudentData();
    if (nextRole === 'student' && sessionStorage.getItem('will-pending-qr')) setTimeout(() => void checkIn(), 250);
  }

  async function initialize() {
    const now = new Date();
    $('#today-label').textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).format(now).replace('.', '');
    if (supabase) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data: profile } = await supabase.from('profiles').select('id,email,full_name,role').eq('id', session.user.id).maybeSingle();
        if (profile) { openPortal(profile.role === 'student' ? 'student' : 'staff', session.user, profile); return; }
        await supabase.auth.signOut();
      }
      supabase.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') showAuth(); });
    }
    showAuth();
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    user = null;
    setCurrentUser(null);
    showAuth();
    toastMessage('Você saiu da sua conta.');
  }

  async function startQrSession() {
    try {
      if (supabase) {
        const { data: sessions, error } = await supabase.from('class_sessions')
          .select('id,starts_at,ends_at,location,class:classes(name)')
          .gte('ends_at', new Date().toISOString()).order('starts_at').limit(1);
        if (error) throw error;
        if (!sessions?.length) { toastMessage('Cadastre uma turma e uma aula na Agenda antes de iniciar a chamada.'); return; }
        const { data, error: qrError } = await supabase.rpc('create_attendance_qr', { p_class_session_id: sessions[0].id, p_valid_minutes: 90 });
        if (qrError) throw qrError;
        const record = Array.isArray(data) ? data[0] : data;
        qrSession = { id: record.qr_session_id, expiresAt: record.qr_expires_at };
        qrToken = record.qr_token;
        $('#qr-session-copy').textContent = `${sessions[0].class?.name || 'Aula'} · peça aos alunos inscritos para escanear o código.`;
      } else {
        qrToken = crypto.randomUUID();
        qrSession = { id: null, expiresAt: new Date(Date.now() + 90 * 60 * 1000).toISOString() };
        $('#qr-session-copy').textContent = 'QR Code de demonstração. Para validar presença entre celulares, conecte o banco e use o site hospedado.';
      }
      const target = new URL(window.location.href);
      target.searchParams.set('checkin', qrToken);
      $('#qr-image').src = await QRCode.toDataURL(target.toString(), { width: 320, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#234f3f', light: '#ffffff' } });
      $('#qr-expiry').textContent = `Válido até ${dateText(qrSession.expiresAt, { hour: '2-digit', minute: '2-digit' })}`;
      openDialog('#qr-modal-backdrop');
    } catch (error) { toastMessage(error.message || 'Não foi possível gerar o QR Code.'); }
  }

  async function endQrSession() {
    try {
      if (supabase && qrSession?.id) {
        const { error } = await supabase.rpc('close_attendance_qr', { p_qr_session_id: qrSession.id });
        if (error) throw error;
      }
      qrSession = null;
      qrToken = null;
      closeDialog('#qr-modal-backdrop');
      toastMessage('Chamada encerrada.');
    } catch (error) { toastMessage(error.message || 'Não foi possível encerrar a chamada.'); }
  }

  async function checkIn() {
    const token = sessionStorage.getItem('will-pending-qr');
    if (!token) { toastMessage('Escaneie o QR Code exibido pelo professor.'); return; }
    if (role !== 'student') { toastMessage('Entre pelo portal do aluno para registrar presença.'); return; }
    try {
      if (supabase) {
        const { error } = await supabase.rpc('check_in_with_qr', { p_token: token });
        if (error) throw error;
        await loadStudentData();
      } else {
        if (attendances.some((item) => item.token === token)) throw new Error('Sua presença nesta chamada já foi registrada.');
        attendances.unshift({ token, checked_in_at: new Date().toISOString(), class_session_id: 'demonstração' });
        localStorage.setItem('will-demo-attendance', JSON.stringify(attendances));
      }
      sessionStorage.removeItem('will-pending-qr');
      history.replaceState({}, '', window.location.pathname);
      view = 'aluno-presenca';
      render();
      toastMessage('Presença registrada com sucesso.');
    } catch (error) { toastMessage(error.message || 'Não foi possível registrar a presença.'); }
  }

  async function sendInvite(event, invitedRole) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const fullName = String(values.get('fullName') || values.get('name')).trim();
    const email = String(values.get('email')).trim().toLowerCase();
    const cpf = String(values.get('cpf') || '').replace(/\D/g, '');
    try {
      if (supabase) {
        let classId = null;
        if (invitedRole === 'student') {
          const { data } = await supabase.from('classes').select('id,name').eq('name', String(values.get('class'))).limit(1);
          classId = data?.[0]?.id || null;
        }
        const { error } = await supabase.functions.invoke('invite-user', { body: { email, fullName, role: invitedRole, classId, cpf } });
        if (error) throw error;
        toastMessage(`Convite enviado para ${email}.`);
        if (invitedRole === 'student') await loadStaffStudents();
      } else if (invitedRole === 'student') {
        const student = { id: crypto.randomUUID(), name: fullName, email, group: String(values.get('group')), className: String(values.get('class')).replace('Vôlei · ', ''), presence: '—', tone: 'green', initials: initials(fullName) };
        students.unshift(student); addedStudents.unshift(student); demoInvites.unshift({ fullName, email, role: 'student' });
        localStorage.setItem('will-treinos-students', JSON.stringify(addedStudents));
        localStorage.setItem('will-treinos-invites', JSON.stringify(demoInvites));
        toastMessage(`Convite demonstrativo preparado para ${email}.`);
      } else {
        demoInvites.unshift({ fullName, email, role: 'assistant' });
        localStorage.setItem('will-treinos-invites', JSON.stringify(demoInvites));
        toastMessage(`Convite demonstrativo preparado para ${email}.`);
      }
      closeAllDialogs();event.currentTarget.reset();view = invitedRole === 'student' ? 'alunos' : 'equipe';render();
    } catch (error) { toastMessage(error.message || 'Não foi possível enviar o convite.'); }
  }

  async function submitAbsence(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const file = values.get('attachment');
    if (file?.size > 10 * 1024 * 1024) { toastMessage('O anexo precisa ter até 10 MB.'); return; }
    const reason = String(values.get('reason')).trim();
    const absenceDate = String(values.get('absenceDate'));
    try {
      if (supabase) {
        let attachmentPath = null;
        if (file?.size) {
          attachmentPath = `${user.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          const { error: uploadError } = await supabase.storage.from('absence-attachments').upload(attachmentPath, file, { contentType: file.type, upsert: false });
          if (uploadError) throw uploadError;
        }
        const { error } = await supabase.from('absence_justifications').insert({ student_id: user.id, absence_date: absenceDate, reason, attachment_path: attachmentPath });
        if (error) { if (attachmentPath) await supabase.storage.from('absence-attachments').remove([attachmentPath]); throw error; }
        await loadStudentData();
      } else {
        absences.unshift({ id: crypto.randomUUID(), absence_date: absenceDate, reason, attachment_path: file?.size ? file.name : null, status: 'pending', created_at: new Date().toISOString() });
        localStorage.setItem('will-treinos-absences', JSON.stringify(absences));
      }
      closeAllDialogs();event.currentTarget.reset();view = 'aluno-faltas';render();toastMessage('Justificativa enviada para análise.');
    } catch (error) { toastMessage(error.message || 'Não foi possível enviar a justificativa.'); }
  }

  async function registerForEvent(eventId) {
    try {
      if (supabase) {
        const item = events.find((candidate) => candidate.id === eventId);
        const result = item?.registered
          ? await supabase.from('event_registrations').delete().eq('event_id', eventId).eq('student_id', user.id)
          : await supabase.from('event_registrations').insert({ event_id: eventId, student_id: user.id });
        if (result.error) throw result.error;
        await loadStudentData();
      } else {
        const item = events.find((candidate) => candidate.id === eventId);
        if (item) item.registered = !item.registered;
        localStorage.setItem('will-treinos-events', JSON.stringify(events.filter((candidate) => !String(candidate.id).startsWith('demo-'))));
        render();
      }
      toastMessage('Sua inscrição foi atualizada.');
    } catch (error) { toastMessage(error.message || 'Não foi possível atualizar a inscrição.'); }
  }

  function openComposer(kind) {
    const forms = {
      class: {
        eyebrow: 'AGENDA', title: 'Nova aula',
        fields: '<label>Nome da turma<input name="name" required placeholder="Vôlei · Iniciante" /></label><div class="form-row"><label>Faixa etária<select name="ageGroup"><option>Adultos</option><option>Infantil</option><option>Juvenil</option></select></label><label>Nível<select name="level"><option>Iniciante</option><option>Intermediário</option><option>Avançado</option></select></label></div><label>Local<input name="location" required value="Quadra comunitária do Ouro Verde" /></label><label>Data<input name="date" type="date" required /></label><div class="form-row"><label>Início<input name="starts" type="time" required /></label><label>Término<input name="ends" type="time" required /></label></div>',
      },
      event: {
        eyebrow: 'COMUNIDADE', title: 'Novo campeonato ou encontro',
        fields: '<label>Nome da atividade<input name="title" required placeholder="Ex.: Festival de vôlei" /></label><label>Descrição<textarea name="description" rows="3" placeholder="Informações para os alunos"></textarea></label><label>Local<input name="location" required placeholder="Quadra comunitária do Ouro Verde" /></label><div class="form-row"><label>Data<input name="date" type="date" required /></label><label>Horário<input name="time" type="time" required /></label></div>',
      },
      notice: {
        eyebrow: 'COMUNICAÇÃO', title: 'Novo aviso',
        fields: '<label>Título<input name="title" required placeholder="Assunto do comunicado" /></label><label>Mensagem<textarea name="body" rows="5" required placeholder="Escreva o aviso para alunos e equipe"></textarea></label>',
      },
      chat: {
        eyebrow: 'EQUIPE', title: 'Mensagem para a equipe',
        fields: '<label>Mensagem<textarea name="body" rows="5" required maxlength="2000" placeholder="Escreva uma mensagem para os auxiliares"></textarea></label>',
      },
    };
    const config = forms[kind];
    if (!config) return;
    $('#compose-modal-eyebrow').textContent = config.eyebrow;
    $('#compose-modal-title').textContent = config.title;
    $('#compose-form').innerHTML = `${config.fields}<div class="modal-actions"><button type="button" class="button button-light close-compose-modal">Cancelar</button><button type="submit" class="button button-primary">Salvar <span>↗</span></button></div>`;
    $('#compose-form').dataset.kind = kind;
    $('#compose-form').querySelector('.close-compose-modal').addEventListener('click', () => closeDialog('#compose-modal-backdrop'));
    openDialog('#compose-modal-backdrop', '#compose-form input, #compose-form textarea');
  }

  async function saveComposer(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const kind = form.dataset.kind;
    try {
      if (kind === 'class') {
        const classRecord = {
          name: String(values.get('name')).trim(), age_group: String(values.get('ageGroup')),
          level: String(values.get('level')), location: String(values.get('location')).trim(),
          weekday: new Date(`${values.get('date')}T12:00:00`).getDay(), starts_at: String(values.get('starts')),
          ends_at: String(values.get('ends')), created_by: user.id,
        };
        if (supabase) {
          const { data: created, error } = await supabase.from('classes').insert(classRecord).select('id').single();
          if (error) throw error;
          const startsAt = new Date(`${values.get('date')}T${values.get('starts')}`).toISOString();
          const endsAt = new Date(`${values.get('date')}T${values.get('ends')}`).toISOString();
          const { error: sessionError } = await supabase.from('class_sessions').insert({ class_id: created.id, starts_at: startsAt, ends_at: endsAt, location: classRecord.location, created_by: user.id });
          if (sessionError) throw sessionError;
        } else {
          const session = { id: crypto.randomUUID(), class_name: classRecord.name, starts_at: new Date(`${values.get('date')}T${values.get('starts')}`).toISOString(), ends_at: new Date(`${values.get('date')}T${values.get('ends')}`).toISOString(), location: classRecord.location };
          const saved = JSON.parse(localStorage.getItem('will-treinos-sessions') || '[]');
          saved.unshift(session);localStorage.setItem('will-treinos-sessions', JSON.stringify(saved));
        }
      } else if (kind === 'event') {
        const item = { title: String(values.get('title')).trim(), description: String(values.get('description') || '').trim(), location: String(values.get('location')).trim(), starts_at: new Date(`${values.get('date')}T${values.get('time')}`).toISOString(), status: 'published' };
        if (supabase) { const { error } = await supabase.from('events').insert({ ...item, created_by: user.id }); if (error) throw error; }
        else { item.id = crypto.randomUUID(); events.unshift(item); localStorage.setItem('will-treinos-events', JSON.stringify(events.filter((candidate) => !String(candidate.id).startsWith('demo-')))); }
      } else if (kind === 'notice') {
        const item = { title: String(values.get('title')).trim(), body: String(values.get('body')).trim(), audience: 'all', published_at: new Date().toISOString() };
        if (supabase) { const { error } = await supabase.from('announcements').insert({ ...item, created_by: user.id }); if (error) throw error; }
        else { item.id = crypto.randomUUID(); notices.unshift(item);localStorage.setItem('will-treinos-notices', JSON.stringify(notices)); }
      } else if (kind === 'chat') {
        const item = { body: String(values.get('body')).trim(), author_id: user.id };
        if (supabase) { const { error } = await supabase.from('staff_messages').insert(item); if (error) throw error; }
        else { messages.unshift({ ...item, author_name: user.full_name, sent_at: new Date().toISOString() });localStorage.setItem('will-treinos-messages', JSON.stringify(messages)); }
      }
      closeDialog('#compose-modal-backdrop');form.reset();render();
      toastMessage(kind === 'class' ? 'Aula cadastrada.' : kind === 'event' ? 'Atividade publicada.' : kind === 'notice' ? 'Aviso publicado.' : 'Mensagem enviada para a equipe.');
    } catch (error) { toastMessage(error.message || 'Não foi possível salvar.'); }
  }

  function exportStudents() {
    const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const csv = [['Nome', 'E-mail', 'Faixa etária', 'Turma', 'Frequência'], ...students.map((item) => [item.name, item.email, item.group, item.className, item.presence])]
      .map((row) => row.map(quote).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');link.href = url;link.download = 'alunos-will-treinos.csv';link.click();URL.revokeObjectURL(url);
    toastMessage('Lista de alunos exportada.');
  }

  async function shareEvent() {
    const item = eventList()[0];
    if (!item) { toastMessage('Crie um campeonato para compartilhar.'); return; }
    try {
      if (navigator.share) await navigator.share({ title: item.title, text: item.description, url: window.location.href });
      else { await navigator.clipboard.writeText(window.location.href);toastMessage('Link copiado para compartilhar.'); }
    } catch (error) { if (error.name !== 'AbortError') toastMessage('Não foi possível compartilhar o link.'); }
  }

  function navigateTo(nextView) {
    view = nextView;
    render();
    toggleSidebar(false);
  }

  $('#login-form').addEventListener('submit', login);
  $$('[data-auth-role]').forEach((button) => button.addEventListener('click', () => selectAuthRole(button.dataset.authRole)));
  $$('[data-demo-role]').forEach((button) => button.addEventListener('click', () => {
    const demoRole = button.dataset.demoRole;
    openPortal(demoRole, { id: `demo-${demoRole}`, full_name: demoRole === 'student' ? 'Aluno de demonstração' : 'Willian', email: demoRole === 'student' ? 'aluno@demonstracao.local' : 'willian@demonstracao.local' });
  }));
  $('#student-form').addEventListener('submit', (event) => void sendInvite(event, 'student'));
  $('#invite-form').addEventListener('submit', (event) => void sendInvite(event, 'assistant'));
  $('#absence-form').addEventListener('submit', submitAbsence);
  $('#compose-form').addEventListener('submit', saveComposer);

  $('.close-modal').addEventListener('click', () => closeDialog('#modal-backdrop'));
  $$('.close-invite-modal').forEach((button) => button.addEventListener('click', () => closeDialog('#invite-modal-backdrop')));
  $$('.close-qr-modal').forEach((button) => button.addEventListener('click', () => closeDialog('#qr-modal-backdrop')));
  $$('.close-absence-modal').forEach((button) => button.addEventListener('click', () => closeDialog('#absence-modal-backdrop')));
  $('#close-qr-session').addEventListener('click', endQrSession);
  $('#mobile-menu').addEventListener('click', () => toggleSidebar(menuButton.getAttribute('aria-expanded') !== 'true'));
  sidebarBackdrop.addEventListener('click', () => toggleSidebar(false));
  $('#profile-button').addEventListener('click', () => void signOut());
  $('.notification-button').addEventListener('click', () => navigateTo(role === 'student' ? 'aluno-avisos' : 'avisos'));
  $('#people-search').addEventListener('input', (event) => {
    clearTimeout(profileSearchTimer);
    const query = event.currentTarget.value;
    profileSearchTimer = setTimeout(() => void searchPeople(query), 220);
  });
  $('#people-search').addEventListener('focus', (event) => {
    if (event.currentTarget.value.trim().length >= 2) void searchPeople(event.currentTarget.value);
  });

  document.addEventListener('click', async (event) => {
    const personResult = event.target.closest('[data-person-profile]');
    if (personResult) { await openPersonProfile(personResult.dataset.personProfile); return; }
    if (!event.target.closest('#people-search-wrap')) closePeopleSearch();
    const nav = event.target.closest('[data-view]');
    if (nav) { navigateTo(nav.dataset.view); return; }
    const action = event.target.closest('[data-action]');
    if (!action) return;
    event.preventDefault();
    const type = action.dataset.action;
    if (type === 'add-student') openDialog('#modal-backdrop', '#student-form [name="name"]');
    else if (type === 'invite') openDialog('#invite-modal-backdrop', '#invite-form [name="fullName"]');
    else if (type === 'start-qr' || type === 'attendance') await startQrSession();
    else if (type === 'new-absence') openDialog('#absence-modal-backdrop', '#absence-form [name="absenceDate"]');
    else if (type === 'check-in') await checkIn();
    else if (type === 'register-event') await registerForEvent(action.dataset.eventId);
    else if (type === 'logout') await signOut();
    else if (type === 'view') navigateTo(action.dataset.target);
    else if (type === 'back-to-people') { view = 'inicio'; render(); }
    else if (type === 'export') exportStudents();
    else if (type === 'new-class') openComposer('class');
    else if (type === 'new-event') openComposer('event');
    else if (type === 'new-notice') openComposer('notice');
    else if (type === 'team-chat') openComposer('chat');
    else if (type === 'share') await shareEvent();
  });

  document.addEventListener('input', (event) => { if (event.target.id === 'student-search') renderStaff('alunos', event.target.value); });
  document.addEventListener('change', (event) => {
    if (event.target.id === 'group-filter') {
      const filter = event.target.value;
      document.querySelectorAll('#student-table tr').forEach((row) => { row.hidden = Boolean(filter) && !row.cells[1]?.textContent.includes(filter); });
    }
    if (event.target.name === 'attachment' && event.target.files[0]?.size > 10 * 1024 * 1024) {
      event.target.value = '';toastMessage('O anexo precisa ter até 10 MB.');
    }
  });
  document.addEventListener('click', (event) => {
    const backdrop = event.target.closest('.modal-backdrop');
    if (backdrop && event.target === backdrop) closeDialog(`#${backdrop.id}`);
  });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && role === 'staff' && !$('#people-search-wrap').hidden) {
      event.preventDefault();$('#people-search').focus();
    }
    if (event.key === 'Escape') {
      closePeopleSearch();
      closeAllDialogs();
      if (menuButton.getAttribute('aria-expanded') === 'true') toggleSidebar(false);
    }
  });

  initialize();
}
