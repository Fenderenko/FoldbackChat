// Overlay window: renders the merged chat, plays sounds, relays YouTube to the OBS scenes.
// Messages are kept in a short history and the list is rebuilt from it on every settings change, so
// options apply to messages already on screen and a larger "how many" brings hidden ones back.
// At /obs the same page is an OBS browser source: always locked, silent, no relay; settings and test
// messages come from the host over /events. /obs?featured shows only the featured message, /obs?alerts the events
// (subs, raids, bits, Super Chats) one at a time with their sound — both from /api/events.
// The in-app window is the source of the local API: every message, deletion and state goes to /api/push.
(() => {
  const list = document.getElementById('list'), head = document.getElementById('head'), hint = document.getElementById('hint'), more = document.getElementById('more');
  const params = new URLSearchParams(location.search);
  const OBS = location.pathname === '/obs' || params.has('obs');
  const FEAT = OBS && params.has('featured'), ALERTS = OBS && params.has('alerts');
  document.body.classList.toggle('obs', OBS);
  document.body.classList.toggle('feat', FEAT || ALERTS);
  document.body.classList.toggle('alerts', ALERTS);
  const ICON = {
    tw: '<svg class="pf" viewBox="0 0 24 24"><path fill="#a970ff" d="M4 3 3 7v12h4v3h3l3-3h4l5-5V3H4Zm16 10-3 3h-4l-3 3v-3H6V5h14v8Z"/><path fill="#a970ff" d="M15 7h2v5h-2zM10 7h2v5h-2z"/></svg>',
    yt: '<svg class="pf" viewBox="0 0 24 24"><rect x="1.5" y="5" width="21" height="14" rx="4" fill="#ff3d3d"/><path fill="#fff" d="m10 9 5.2 3-5.2 3z"/></svg>',
    kk: '<svg class="pf" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" fill="#53fc18"/><path fill="#0b0b0b" d="M7.5 6h3v4.2L13.8 6h3.6l-4 5.4 4.2 6.6h-3.7l-2.8-4.6-.6.8V18h-3z"/></svg>',
    // Channel points reward.
    pts: '<svg class="pf" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 8a4 4 0 0 1 4 4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  };
  const HIST_MAX = 200;
  let hist = [];
  // History scroll: how many of the newest messages are skipped (0 = live). Only while unlocked.
  let back = 0;
  let lastPing = 0;
  const host = { locked: true, hk: [] };
  const hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

  function apply() {
    const s = FC.s, b = document.body.style;
    // "own" is any font installed in Windows, by name; quotes and backslashes are dropped so the name can't break the CSS.
    const font = (k, own) => `'${k === 'own' ? String(own || 'Segoe UI').replace(/['"\\;]/g, '') : (FC.FONTS[k] || FC.FONTS.plex)[0]}', 'Segoe UI', sans-serif`;
    b.setProperty('--fs', s.font + 'px');
    b.setProperty('--card', 1 - s.cardT);
    b.setProperty('--cardc', s.cardColor);
    b.setProperty('--panel', 1 - s.panelT);
    b.setProperty('--panelc', s.panelColor);
    b.setProperty('--radius', s.cardRadius + 'px');
    b.setProperty('--gap', s.gap + 'px');
    b.setProperty('--tq', s.accent);
    b.setProperty('--fg', s.text);
    b.setProperty('--emo', s.emoteSize + 'em');
    b.setProperty('--fname', font(s.fontName, s.fontNameOwn));
    b.setProperty('--ftext', font(s.fontText, s.fontTextOwn));
    b.setProperty('--wname', s.nameWeight);
    b.setProperty('--wtext', s.textWeight);
    b.setProperty('--ol', s.outline);
    b.setProperty('--hfs', s.hdrSize + 'px');
    b.setProperty('--hc', s.hdrColor);
    b.setProperty('--hbg', 1 - s.hdrT);
    b.setProperty('--fscale', s.featScale);
    document.body.classList.toggle('lines', s.style === 'lines');
    document.body.classList.toggle('noletter', !s.letter);
    document.body.classList.toggle('upper', !!s.nameUpper);
    document.body.classList.toggle('top', s.newestTop);
    document.body.classList.toggle('al-bar', s.alertStyle === 'bar');
    for (const k of ['ring', 'glow', 'bar', 'tint']) document.body.classList.toggle('hl-' + k, (s.hlStyle || 'ring') === k);
    head.style.display = s.showHeader ? '' : 'none';
    renderAll();
    drawHead();
  }

  function build(m) {
    const s = FC.s;
    const el = document.createElement('div');
    const ev = m.kind !== 'chat';
    el.className = 'msg' + (m.mention ? ' mention' : '') + (m.first && s.hlFirst ? ' first' : '') + (ev && s.hlEvents ? ' event' : '') + (m.own ? ' own' : '') + (m.highlighted && s.hlPoints ? ' hl' : '');
    el.dataset.id = m.id || '';
    el.dataset.login = (m.login || '').toLowerCase();
    const col = ev ? (m.kind === 'raid' ? 'var(--ac)' : m.platform === 'yt' ? '#ffcf5a' : 'var(--lav)') : m.own ? '#f2f2f2' : FC.color(m);
    el.style.setProperty('--c', col);
    const L = document.createElement('div'); L.className = 'L'; L.textContent = FC.initial(m.name);
    const b = document.createElement('div'); b.className = 'b';
    const top = document.createElement('div'); top.className = 'top';
    // The platform mark is always the first element of the line, so toggling it never shifts the rest.
    if (s.showPlatform) top.insertAdjacentHTML('beforeend', ICON[m.platform] || '');
    // Badge pictures (as on Twitch) go before the name; platforms without pictures keep the words.
    const imgs = s.showBadges && s.badgeStyle === 'img' ? FC.badgeImgs(m) : [];
    for (const b of imgs) { const i = document.createElement('img'); i.className = 'bi'; i.src = b.src; i.alt = i.title = b.title; top.appendChild(i); }
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = m.name; top.appendChild(nm);
    if (m.reward && s.hlPoints) top.insertAdjacentHTML('beforeend', ICON.pts);
    const mark = FC.person(m)?.mark;
    if (mark) { const x = document.createElement('span'); x.className = 'bd'; x.textContent = mark; top.appendChild(x); }
    if (s.showBadges) {
      const bd = m.badges || {}, pics = imgs.length > 0;
      const tags = [!pics && bd.owner && 'стрімер', !pics && bd.mod && s.hlMods && 'мод', !pics && bd.vip && 'vip', !pics && bd.member && 'спонсор', m.first && s.hlFirst && 'вперше'].filter(Boolean);
      for (const t of tags) { const x = document.createElement('span'); x.className = 'bd'; x.textContent = FC.t(t); top.appendChild(x); }
    }
    // 7TV: the person's paint on the name and their 7TV badge after it, once known (cached after the first look-up).
    if (s.stv && s.e7tv && m.kind === 'chat' && !m.own) {
      FC.stv(m).then(({ paint, badge }) => {
        if (paint) { nm.classList.add('painted'); nm.style.backgroundImage = paint.image; nm.style.filter = paint.filter; nm.classList.toggle('pimg', paint.url); }
        if (badge && s.showBadges) { const i = document.createElement('img'); i.className = 'bi'; i.src = badge.src; i.alt = i.title = badge.title; nm.after(i); }
      });
    }
    if (s.showTime) { const t = document.createElement('span'); t.className = 't'; t.textContent = hhmm(new Date(m.at)); top.appendChild(t); }
    b.appendChild(top);
    if (m.reply && s.showReplies) { const r = document.createElement('div'); r.className = 'rp'; r.textContent = `↪ ${m.reply.name}: ${m.reply.text}`; b.appendChild(r); }
    if (m.amount) { const a = document.createElement('div'); a.className = 'am'; a.textContent = m.amount; b.appendChild(a); }
    if (m.parts && m.parts.length && (m.text || '').trim()) {
      const x = document.createElement('div'); x.className = 'x';
      for (const p of m.parts) {
        if (p.img) { const i = document.createElement('img'); i.src = p.img; i.alt = p.alt || ''; x.appendChild(i); } else x.appendChild(document.createTextNode(p.t));
      }
      b.appendChild(x);
    }
    el.append(L, b);
    return el;
  }

  // Messages that are still due on screen: the newest maxMsgs, minus those whose fade time has passed.
  // While scrolled back, faded messages count too: that is the point of looking back.
  function visible() {
    const s = FC.s, now = Date.now(), n = Math.max(1, s.maxMsgs | 0);
    if (back > 0) return hist.slice(0, hist.length - back).slice(-n);
    return hist.filter((m) => !(s.fade > 0 && now - m.at > s.fade * 1000)).slice(-n);
  }

  // Before the first message: what to do when no channel is set, or that the chat is connected and waiting.
  // The waiting line stays out of the OBS source, viewers don't need it.
  function placeholder() {
    const s = FC.s, hk = host.hk?.[2];
    let txt = '';
    if (!(s.twitchOn && s.twitch) && !(s.ytOn && s.youtube) && !(s.kickOn && s.kick)) txt = !OBS && hk && hk !== '-' ? FC.t('Вкажи канал у налаштуваннях ({hk})', { hk }) : FC.t('Вкажи канал у налаштуваннях Foldback Chat');
    else if (!OBS && (FC.status.tw === 'live' || FC.status.yt === 'live' || FC.status.kk === 'live')) txt = FC.t('Підключено · чекаємо на повідомлення');
    if (!txt) return [];
    const el = document.createElement('div');
    el.className = 'ph';
    el.textContent = txt;
    return [el];
  }

  function renderAll() {
    if (FEAT) { list.replaceChildren(...(featured ? [build(FC.fromApi(featured))] : [])); return; }
    if (ALERTS) return;
    const items = visible().map((m) => { const el = build(m); el.style.animation = 'none'; return el; });
    if (FC.s.newestTop) items.reverse();
    list.replaceChildren(...(hist.length ? items : placeholder()));
    more.textContent = back > 0 ? `${FC.s.newestTop ? '↑' : '↓'} ${back}` : '';
    document.body.classList.toggle('back', back > 0);
  }

  // Mouse wheel from the host (unlocked window only): up = older messages; reversed when the newest are on top.
  window.fcWheel = (delta) => {
    if (host.locked || !delta) return;
    const older = (delta > 0) !== !!FC.s.newestTop;
    const max = Math.max(0, hist.length - 1);
    back = Math.min(max, Math.max(0, back + (older ? 3 : -3)));
    renderAll();
  };

  function add(m) {
    hist.push(m);
    if (hist.length > HIST_MAX) hist = hist.slice(-HIST_MAX);
    wake();
    if (hist.length === 1) list.replaceChildren();
    // Looking back: the view stays put, the counter of newer messages grows.
    if (back > 0) { back = Math.min(back + 1, hist.length - 1); more.textContent = `${FC.s.newestTop ? '↑' : '↓'} ${back}`; return; }
    const s = FC.s, el = build(m);
    if (s.newestTop) list.prepend(el); else list.appendChild(el);
    while (list.children.length > Math.max(1, s.maxMsgs | 0)) (s.newestTop ? list.lastChild : list.firstChild).remove();
    if (s.fade > 0) setTimeout(() => { el.classList.add('gone'); setTimeout(() => el.remove(), 900); }, s.fade * 1000);
  }

  // "Hide when quiet": the whole chat shows for idleHide seconds after a message or a settings change.
  let idleTimer = 0;
  function wake() {
    if (FEAT || ALERTS) return;
    clearTimeout(idleTimer);
    document.body.classList.remove('idle');
    if (FC.s.idleHide > 0) idleTimer = setTimeout(() => document.body.classList.add('idle'), FC.s.idleHide * 1000);
  }

  function sound(m) {
    const s = FC.s;
    if (OBS || (m.own && s.quietOwn)) return;
    if (m.kind !== 'chat') return FC.play('event');
    if (m.mention) return FC.play('mention');
    if (m.first) return FC.play('first');
    if (Date.now() - lastPing < s.cooldown * 1000) return;
    lastPing = Date.now();
    FC.play('msg');
  }

  FC.onMessage((m) => {
    m.at = Date.now();
    add(m);
    sound(m);
    if (m.platform === 'yt' && !OBS) FC.relay(m);
    if (!OBS) FC.apiPush(`id=${encodeURIComponent(m.id || '')}&login=${encodeURIComponent(m.login || '')}`, FC.apiMsg(m));
  });
  FC.onClear = (c) => {
    if (!OBS) {
      if (c.id) FC.apiPush('del=' + encodeURIComponent(c.id), { type: 'delete', id: c.id });
      else FC.apiPush('clear=' + encodeURIComponent(c.login || ''), { type: 'clear', login: c.login || '' });
    }
    const hit = (m) => (c.id && m.id === c.id) || (c.login && (m.login || '').toLowerCase() === c.login.toLowerCase()) || (!c.id && !c.login);
    hist = hist.filter((m) => !hit(m));
    renderAll();
  };

  // Top line: platform states, viewers, uptime (public, via decapi.me), clock — each can be switched off.
  let viewers = '', uptime = '';
  function drawHead() {
    const s = FC.s;
    const st = (k, label) => `<span class="st ${FC.status[k]}"><i></i>${label}${FC.status[k + 'Note'] && FC.status[k] !== 'live' ? ' · ' + FC.t(FC.status[k + 'Note']) : ''}</span>`;
    const left = (s.hdrTw && s.twitchOn && s.twitch ? st('tw', 'Twitch') : '') + (s.hdrYt && s.ytOn && s.youtube ? st('yt', 'YouTube') : '') + (s.hdrKk && s.kickOn && s.kick ? st('kk', 'Kick') : '');
    const right = (s.hdrViewers && viewers ? `<span>${FC.t('{n} глядач.', { n: viewers })}</span>` : '') + (s.hdrUptime && uptime ? `<span>${uptime}</span>` : '') + (s.hdrClock ? `<span>${hhmm(new Date())}</span>` : '');
    // Nothing to show: no line at all (an empty dark strip looked like a broken window).
    head.innerHTML = left || right ? left + '<span class="sp"></span>' + right : '';
  }
  async function stats() {
    const ch = FC.s.twitch;
    if (!ch || !FC.s.showHeader) return;
    const get = (p) => fetch(`https://decapi.me/twitch/${p}/${encodeURIComponent(ch)}`).then((r) => r.text()).catch(() => '');
    const [v, u] = await Promise.all([get('viewercount'), get('uptime')]);
    viewers = /^\d+$/.test(v.trim()) ? v.trim() : '';
    if (/offline/i.test(u) || !/(hour|minute)/.test(u)) uptime = '';
    else { const h = +(u.match(/(\d+) hour/) || [0, 0])[1], mi = +(u.match(/(\d+) minute/) || [0, 0])[1]; uptime = `${h}:${String(mi).padStart(2, '0')}`; }
    drawHead();
  }
  // The tray tip names the state of each set channel.
  let tip = '';
  const sendTip = () => {
    const s = FC.s, lines = ['Foldback Chat'];
    if (s.twitchOn && s.twitch) lines.push('Twitch: ' + FC.statusText(FC.status.tw, FC.status.twNote));
    if (s.ytOn && s.youtube) lines.push('YouTube: ' + FC.statusText(FC.status.yt, FC.status.ytNote));
    if (s.kickOn && s.kick) lines.push('Kick: ' + FC.statusText(FC.status.kk, FC.status.kkNote));
    if (lines.join('\n') !== tip) { tip = lines.join('\n'); FC.host('tip', tip); }
  };
  const sendStatus = () => FC.apiPush('', { type: 'status', twitch: FC.status.tw, youtube: FC.status.yt, kick: FC.status.kk, twitchNote: FC.status.twNote || '', youtubeNote: FC.status.ytNote || '', kickNote: FC.status.kkNote || '' });
  FC.onStatus(() => { drawHead(); if (!hist.length) renderAll(); if (!OBS) { sendTip(); sendStatus(); } });
  setInterval(stats, 60e3);
  setInterval(() => { if (FC.s.hdrClock) drawHead(); }, 15e3);

  // Host state (lock, hotkeys) pushed by the app, also fetched on load. The OBS source is always locked.
  window.fcHost = (st) => {
    Object.assign(host, st, OBS ? { locked: true } : {});
    document.body.classList.toggle('locked', !!host.locked);
    if (host.locked && back) { back = 0; renderAll(); }
    if (!hist.length) renderAll();
    hint.textContent = FC.t('Тягни — перемістити · краї — розмір · {hk} — закріпити', { hk: host.hk?.[1] || 'Alt+Shift+X' });
  };
  FC.state().then(window.fcHost);
  // The host's own texts (tray menu, window titles) follow the page language.
  let lang = '';
  const sendLang = () => { if (!OBS && FC.lang() !== lang) { lang = FC.lang(); FC.host('lang', lang); window.fcHost({}); } };

  // Test messages from the settings page: through the shared storage here, through /events in the OBS source.
  const test = (t) => FC.emit({ platform: t.platform || 'tw', kind: t.kind || 'chat', id: 'test' + Date.now(), login: t.name.toLowerCase(), name: t.name, text: t.text, parts: [{ t: t.text }], first: !!t.first, badges: t.badges || {}, amount: t.amount || '', reply: t.reply || null, highlighted: !!t.highlighted, reward: !!t.reward, color: t.color || '' });
  if (OBS) {
    const es = new EventSource('/events');
    es.addEventListener('settings', () => FC.pull());
    if (!FEAT) es.addEventListener('test', (e) => { try { test(JSON.parse(e.data)); } catch { /* not a test message */ } });
  } else {
    addEventListener('storage', (e) => { if (e.key === 'fc.test' && e.newValue) test(JSON.parse(e.newValue)); });
  }

  // The featured source: one card, as in the chat but larger; it leaves after featSec seconds (the host is told,
  // so the dock shows it as taken off too).
  let featured = null, featTimer = 0;
  function feature(a) {
    clearTimeout(featTimer);
    const old = list.firstChild;
    if (old) { old.classList.add('gone'); setTimeout(() => old.remove(), 800); }
    featured = a;
    if (!a) return;
    list.appendChild(build(FC.fromApi(a)));
    if (FC.s.featSec > 0) featTimer = setTimeout(() => fetch('/api/unfeature?id=' + encodeURIComponent(a.id || ''), { method: 'POST' }).catch(() => {}), FC.s.featSec * 1000);
  }
  if (FEAT) {
    const api = new EventSource('/api/events');
    api.onmessage = (e) => { try { const d = JSON.parse(e.data); if (d.type === 'featured' && (d.message?.id || null) !== (featured?.id || null)) feature(d.message); } catch { /* not JSON */ } };
  }

  // The alerts source: events wait in a queue and show one at a time, as a card (like the chat, larger) or a bar
  // that drops in from the top, each with the events sound.
  const queue = [];
  let alerting = false;
  function alertBar(m) {
    const el = document.createElement('div');
    el.className = 'abar';
    el.style.setProperty('--c', m.kind === 'raid' ? 'var(--ac)' : m.platform === 'yt' ? '#ffcf5a' : 'var(--lav)');
    el.insertAdjacentHTML('beforeend', ICON[m.platform] || '');
    const n = document.createElement('b'); n.textContent = m.name;
    const a = document.createElement('span'); a.className = 'aam'; a.textContent = m.amount;
    const x = document.createElement('span'); x.className = 'atx'; x.textContent = m.text || '';
    el.append(n, a, x);
    return el;
  }
  function nextAlert() {
    if (alerting || !queue.length) return;
    alerting = true;
    const m = FC.fromApi(queue.shift());
    const el = FC.s.alertStyle === 'bar' ? alertBar(m) : build(m);
    el.classList.add('alert');
    list.replaceChildren(el);
    FC.play('event');
    setTimeout(() => {
      el.classList.add('gone');
      setTimeout(() => { el.remove(); alerting = false; nextAlert(); }, 700);
    }, Math.max(2, FC.s.alertSec || 6) * 1000);
  }
  if (ALERTS) {
    const api = new EventSource('/api/events');
    api.onmessage = (e) => { try { const d = JSON.parse(e.data); if (d.type === 'message' && d.kind && d.kind !== 'chat') { queue.push(d); nextAlert(); } } catch { /* not JSON */ } };
  }

  let cur = '';
  function connect() {
    if (FEAT || ALERTS) return;
    const s = FC.s;
    const tw = [s.twitch, s.twitchOn, s.e7tv, s.eBttv, s.eFfz].join('|'), yt = [s.youtube, s.ytOn].join('|'), kk = [s.kick, s.kickOn, s.e7tv].join('|');
    const [ptw, pyt, pkk] = cur ? cur.split('#') : ['', '', ''];
    if (tw !== ptw) FC.twitch(s.twitch);
    if (yt !== pyt) FC.youtube(s.youtube);
    if (kk !== pkk) FC.kick(FC.KICK ? s.kick : '');
    if (tw !== ptw) stats();
    cur = [tw, yt, kk].join('#');
  }
  FC.onChange(() => { apply(); wake(); connect(); sendLang(); if (!OBS) sendTip(); });
  apply();
  wake();
  // Channels only once the settings file is read: the page storage may be stale or empty.
  FC.ready.then((hasHost) => {
    connect();
    sendLang();
    if (OBS) return;
    sendTip();
    // First start (or no channel left): the settings open on the channels page.
    const s = FC.s;
    if (hasHost && !s.twitch && !s.youtube && !s.kick) {
      try { localStorage.setItem('fc.page', 'channels'); } catch { /* storage unavailable */ }
      FC.host('settings');
    }
  });
})();
