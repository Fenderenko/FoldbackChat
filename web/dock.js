// OBS dock (/dock): the whole chat from the local API (/api/recent, /api/events) with its history. A click puts a
// message on stream through the featured source (/obs?featured); a second click or the button takes it off. A click
// on a name shows that person's messages only; what moderators delete stays, struck through.
(async () => {
  const t = FC.t;
  const list = document.getElementById('list'), chips = document.getElementById('chips'), newer = document.getElementById('newer');
  const tip = document.getElementById('tip'), clear = document.getElementById('clear');
  // Longer than the chat: the dock is where history is read.
  const MAX = 500;
  const ICON = {
    twitch: '<svg class="pf" viewBox="0 0 24 24"><path fill="#a970ff" d="M4 3 3 7v12h4v3h3l3-3h4l5-5V3H4Zm16 10-3 3h-4l-3 3v-3H6V5h14v8Z"/><path fill="#a970ff" d="M15 7h2v5h-2zM10 7h2v5h-2z"/></svg>',
    youtube: '<svg class="pf" viewBox="0 0 24 24"><rect x="1.5" y="5" width="21" height="14" rx="4" fill="#ff3d3d"/><path fill="#fff" d="m10 9 5.2 3-5.2 3z"/></svg>',
    kick: '<svg class="pf" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" fill="#53fc18"/><path fill="#0b0b0b" d="M7.5 6h3v4.2L13.8 6h3.6l-4 5.4 4.2 6.6h-3.7l-2.8-4.6-.6.8V18h-3z"/></svg>',
  };
  let filter = 'all', person = '', featuredId = null, unseen = 0;
  const who = document.getElementById('who');
  // A row is shown when it passes both the platform chip and the person filter.
  const fits = (r) => (filter === 'all' || r.dataset.pf === filter) && (!person || r.dataset.login === person);
  const refilter = () => { for (const r of list.children) if (r.dataset.pf) r.hidden = !fits(r); list.scrollTop = list.scrollHeight; };
  const setPerson = (login, name) => {
    person = login;
    who.hidden = !person;
    who.firstChild.textContent = person ? t('Розмова: {name}', { name }) : '';
    refilter();
  };
  who.lastChild.onclick = () => setPerson('', '');
  await FC.ready;
  document.documentElement.lang = FC.lang();
  // The window theme of the settings; «Same as Windows» and OLED need the Windows accent and mode from the host.
  const theme = async () => { const st = await FC.state(); FC.applyTheme({ accent: st.accent, light: !!st.light }); };
  theme();
  FC.onChange(theme);
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', theme);
  tip.textContent = t('клац — на екран, ще раз — прибрати');
  clear.textContent = t('Прибрати');

  for (const [k, label] of [['all', t('Усі')], ['twitch', 'Twitch'], ['youtube', 'YouTube'], ...(FC.KICK ? [['kick', 'Kick']] : [])]) {
    const c = document.createElement('button');
    c.className = 'chip' + (k === filter ? ' on' : '');
    c.textContent = label;
    c.onclick = () => {
      filter = k;
      for (const x of chips.children) x.classList.toggle('on', x === c);
      refilter();
    };
    chips.appendChild(c);
  }

  const atBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  const toBottom = () => { list.scrollTop = list.scrollHeight; unseen = 0; newer.hidden = true; };
  list.addEventListener('scroll', () => { if (atBottom()) toBottom(); });
  newer.onclick = toBottom;

  function row(a) {
    const m = FC.fromApi(a), el = document.createElement('div');
    el.className = 'm' + (m.kind !== 'chat' ? ' ev' : '') + (m.mention ? ' mention' : '') + (m.id && m.id === featuredId ? ' sel' : '');
    el.dataset.id = m.id;
    el.dataset.pf = a.platform || '';
    el.dataset.login = m.login.toLowerCase();
    el.hidden = !fits(el);
    el.insertAdjacentHTML('beforeend', ICON[a.platform] || '');
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = m.name;
    n.style.color = m.kind !== 'chat' ? (m.platform === 'yt' ? '#ffcf5a' : '#a98ef0') : FC.color(m);
    n.title = t('Лише ця людина');
    n.onclick = (e) => { e.stopPropagation(); setPerson(el.dataset.login, m.name); };
    el.appendChild(n);
    if (m.amount) { const x = document.createElement('span'); x.className = 'am'; x.textContent = m.amount; el.appendChild(x); }
    const x = document.createElement('span');
    x.className = 'x';
    for (const p of m.parts) {
      if (p.img) { const i = document.createElement('img'); i.src = p.img; i.alt = p.alt || ''; x.appendChild(i); } else x.appendChild(document.createTextNode(p.t));
    }
    el.appendChild(x);
    if (m.id) el.onclick = () => fetch(m.id === featuredId ? '/api/unfeature' : '/api/feature?id=' + encodeURIComponent(m.id), { method: 'POST' }).catch(() => {});
    return el;
  }

  function add(a) {
    const stick = atBottom();
    list.querySelector('.empty')?.remove();
    list.appendChild(row(a));
    while (list.children.length > MAX) list.firstChild.remove();
    if (stick) toBottom();
    else { unseen++; newer.textContent = t('↓ нові: {n}', { n: unseen }); newer.hidden = false; }
  }

  // Removed by a moderator: kept, struck through, with a mark.
  function struck(r) {
    if (r.classList.contains('del')) return;
    r.classList.add('del');
    const x = document.createElement('small');
    x.className = 'delnote';
    x.textContent = t('видалено');
    r.appendChild(x);
  }

  function note(txt) {
    const el = document.createElement('div');
    el.className = 'empty';
    el.textContent = txt;
    return el;
  }

  async function load() {
    let msgs = [];
    try { msgs = await fetch('/api/recent').then((r) => r.json()); } catch { /* the app is not running */ }
    list.replaceChildren(...(msgs.length ? msgs.map(row) : [note(t('Повідомлень ще немає'))]));
    toBottom();
  }

  function onEvent(d) {
    if (d.type === 'message') add(d);
    else if (d.type === 'delete') { const r = list.querySelector(`[data-id="${CSS.escape(d.id || '')}"]`); if (r) struck(r); }
    else if (d.type === 'clear') for (const r of list.children) { if (r.dataset.pf && (!d.login || r.dataset.login === d.login.toLowerCase())) struck(r); }
    else if (d.type === 'featured') {
      featuredId = d.message?.id || null;
      for (const r of list.children) r.classList.toggle('sel', !!featuredId && r.dataset.id === featuredId);
    }
  }

  // EventSource reconnects by itself (the app may start after OBS); the history is read again on every connect.
  const es = new EventSource('/api/events');
  es.onopen = load;
  es.onmessage = (e) => { try { onEvent(JSON.parse(e.data)); } catch { /* not JSON */ } };
  es.onerror = () => { if (es.readyState !== EventSource.OPEN) list.replaceChildren(note(t('Foldback Chat не запущено'))); };
  clear.onclick = () => fetch('/api/unfeature', { method: 'POST' }).catch(() => {});
  // Name colours follow the settings.
  const set = new EventSource('/events');
  set.addEventListener('settings', () => FC.pull());
})();
