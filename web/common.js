// Shared by the overlay and the settings page: settings store, language, Twitch (anonymous IRC), YouTube (live
// chat through the host's /proxy), 7TV / BTTV / FFZ emotes, name palettes, sounds, relay to the OBS scenes.
(() => {
  const FC = (window.FC = {});
  const KEY = 'fc.settings.v1';

  FC.DEF = {
    twitch: '', twitchOn: true, youtube: '', ytOn: true, lang: 'auto',
    // Look
    style: 'cards', font: 17, emoteSize: 1.6, letter: true, showPlatform: true, showTime: false, showBadges: true,
    fontName: 'plex', fontText: 'plex', fontNameOwn: '', fontTextOwn: '', nameUpper: true, nameWeight: 500, textWeight: 400, outline: 0.6,
    accent: '#e8e8e8', text: '#ececec',
    // Name colours: 'brand' = from the palette, 'twitch' = the viewer's Twitch colour, 'mono' = accent
    nameMode: 'brand', palette: ['#3cc6dc', '#ff7a6b', '#a98ef0'], palGen: 6,
    // Background: transparency 0 = solid, 1 = fully transparent
    cardColor: '#121212', cardT: 0.18, panelColor: '#121212', panelT: 1, cardRadius: 0, gap: 6,
    // Top line
    showHeader: true, hdrTw: true, hdrYt: true, hdrViewers: true, hdrUptime: true, hdrClock: false,
    hdrSize: 13, hdrColor: '#e6e6e6', hdrT: 0.45,
    // Messages
    // idleHide: the whole chat hides after that many quiet seconds and comes back with a new message (0 — never)
    maxMsgs: 12, fade: 0, idleHide: 0, newestTop: false,
    // Featured message (the /obs?featured source): seconds on screen (0 — until taken off), size against the chat
    featSec: 10, featScale: 1.4, hideBots: true, hideCommands: false, hideLinks: false, showReplies: true,
    bots: 'streamelements, nightbot, moobot, streamlabs, soundalerts, sery_bot, wizebot, fossabot, commanderroot',
    ignore: '',
    // Highlights
    mentions: '', hlWords: '', hlFirst: true, hlMods: true, hlEvents: true, hlPoints: true, hlStyle: 'ring',
    // Viewers with their own colour and mark: [{ login, color, mark }]
    people: [],
    // Emotes
    e7tv: true, eBttv: true, eFfz: true,
    // Sounds: per event — sound name ('off' | built-in | 'custom') and volume
    volume: 0.6, cooldown: 2, quietOwn: true,
    snd: { msg: 'kalimba', first: 'bell', mention: 'drop', event: 'fanfare' },
    vol: { msg: 0.5, first: 0.8, mention: 0.9, event: 0.8 },
    // Scenes
    relay: true,
  };

  // Colours of the first (navy) theme: kept only where the user changed them, the rest follow the new defaults.
  const NAVY = { accent: '#3cc6dc', text: '#e8f1f2', cardColor: '#0d1b2a', panelColor: '#0d1b2a' };
  FC.load = () => {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* broken storage: defaults */ }
    if (!(s.theme >= 2)) {
      for (const [k, v] of Object.entries(NAVY)) if (String(s[k] || '').toLowerCase() === v) delete s[k];
      s.theme = 2;
      try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* full */ }
    }
    return { ...FC.DEF, ...s, snd: { ...FC.DEF.snd, ...(s.snd || {}) }, vol: { ...FC.DEF.vol, ...(s.vol || {}) } };
  };
  FC.s = FC.load();
  const changeSubs = [];
  FC.onChange = (f) => changeSubs.push(f);
  addEventListener('storage', (e) => { if (e.key === KEY || (e.key || '').startsWith('fc.snd.')) { FC.s = FC.load(); changeSubs.forEach((f) => f()); } });

  // The host keeps the settings and own sounds in files (/store), and the file wins: WebView2 may reset its storage,
  // and the OBS browser source has a storage of its own. localStorage stays as the fast copy the pages read.
  // store(k) → the file's text ('' — no file), null — the host can't be reached.
  FC.store = (k, v) => fetch('/store?k=' + k, v == null ? {} : { method: 'POST', body: v }).then((r) => (r.ok ? r.text() : null)).catch(() => null);
  // Writes go one at a time and only the newest waiting one is sent; FC.flush() resolves when the file is current.
  let pending = null, writing = null;
  FC.flush = () => writing || (pending == null ? Promise.resolve() : (writing = (async () => {
    while (pending != null) { const v = pending; pending = null; await FC.store('settings', v); }
    writing = null;
  })()));
  FC.save = (s) => {
    const v = JSON.stringify(s);
    try { localStorage.setItem(KEY, v); } catch { /* full */ }
    pending = v;
    FC.flush();
  };
  addEventListener('pagehide', () => { if (pending != null) navigator.sendBeacon('/store?k=settings', pending); });
  const local = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const keep = (k, v) => { try { localStorage.setItem(k, v); } catch { /* full */ } };
  // Takes the settings file into the page; true when they changed (subscribers are told).
  FC.pull = async () => {
    const file = await FC.store('settings');
    if (file == null || !file.trim() || file === local(KEY)) return false;
    keep(KEY, file);
    FC.s = FC.load();
    changeSubs.forEach((f) => f());
    return true;
  };
  // On load: the files win; settings and sounds that exist only in the page storage (before 0.1.2) go to the files.
  // Resolves to false when there is no host (the pages opened from web/ for a check).
  FC.SND_EVENTS = ['msg', 'first', 'mention', 'event'];
  FC.ready = (async () => {
    const file = await FC.store('settings');
    if (file == null) return false;
    if (file.trim()) await FC.pull();
    else if (local(KEY)) { pending = local(KEY); FC.flush(); }
    for (const ev of FC.SND_EVENTS) {
      const k = 'fc.snd.' + ev, f = await FC.store('snd.' + ev), l = local(k);
      if (f && f !== l) keep(k, f);
      else if (!f && l) FC.store('snd.' + ev, l);
    }
    return true;
  })();

  FC.host = (c, v, extra = '') => fetch(`/cmd?c=${encodeURIComponent(c)}${v != null ? '&v=' + encodeURIComponent(v) : ''}${extra}`).catch(() => {});
  FC.state = () => fetch('/state').then((r) => r.json()).catch(() => ({}));

  // ---------- language ----------
  // Keys are the Ukrainian strings; i18n.js holds the other languages. "{name}" in a string is a placeholder.
  FC.LANGS = [['auto', 'Як у Windows'], ['uk', 'Українська'], ['en', 'English'], ['de', 'Deutsch'], ['fr', 'Français'], ['es', 'Español'], ['pt', 'Português'], ['pl', 'Polski'], ['it', 'Italiano'], ['tr', 'Türkçe']];
  FC.lang = () => {
    const l = FC.s.lang;
    if (l && l !== 'auto') return l;
    const sys = String(navigator.language || 'en').slice(0, 2).toLowerCase();
    return sys === 'uk' || (window.I18N || {})[sys] ? sys : 'en';
  };
  FC.t = (k, p) => {
    let s = ((window.I18N || {})[FC.lang()] || {})[k] || k;
    if (p) s = s.replace(/\{(\w+)\}/g, (m, n) => (p[n] ?? m));
    return s;
  };

  // ---------- helpers ----------
  FC.hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

  // ---------- name palettes ----------
  FC.PALETTES = {
    brand: ['Бірюза, корал, лаванда', ['#3cc6dc', '#ff7a6b', '#a98ef0']],
    pastel: ['Пастель', ['#f4a7b9', '#a7c7f4', '#b9f4a7', '#f4e1a7', '#d1a7f4', '#a7f4e6']],
    neon: ['Неон', ['#39ff88', '#ff3df2', '#3df5ff', '#fff23d', '#ff8a3d', '#8a7dff']],
    warm: ['Теплі', ['#ffb36b', '#ff7a6b', '#ffd36b', '#ff9ec4', '#e8a07a']],
    cold: ['Холодні', ['#6bd6ff', '#7a9cff', '#a98ef0', '#6bffd0', '#9fe0ff']],
    gray: ['Відтінки сірого', ['#f2f2f2', '#c8c8cc', '#a0a0a6']],
  };
  // OKLCH → sRGB hex; chroma is lowered until the colour fits sRGB.
  const oklch = (L, C, h) => {
    for (let c = C; c >= 0; c -= 0.005) {
      const a = c * Math.cos((h * Math.PI) / 180), b = c * Math.sin((h * Math.PI) / 180);
      const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
      const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
      if (rgb.every((v) => v >= 0 && v <= 1)) return '#' + rgb.map((v) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)).toString(16).padStart(2, '0')).join('');
    }
    return '#cccccc';
  };
  // n colours of the same lightness and strength, hues evenly apart from a random start: they match and all read on dark.
  FC.genPalette = (n) => {
    const h0 = Math.random() * 360, step = 360 / Math.max(1, n);
    return Array.from({ length: n }, (_, i) => oklch(i % 2 ? 0.84 : 0.78, 0.14, h0 + i * step));
  };
  // A viewer's own colour and mark from the settings, matched by login or display name.
  FC.person = (m) => {
    const keys = [m.login, m.name].map((x) => String(x || '').toLowerCase().replace(/^@/, '')).filter(Boolean);
    return (FC.s.people || []).find((p) => p.login && keys.includes(p.login.toLowerCase().replace(/^@/, ''))) || null;
  };
  FC.color = (m) => {
    const s = FC.s;
    const p = FC.person(m);
    if (p && p.color) return p.color;
    if (s.nameMode === 'mono') return s.accent;
    if (s.nameMode === 'twitch' && /^#[0-9a-f]{6}$/i.test(m.color || '')) {
      // Lift dark Twitch colours so they read on the dark cards.
      const n = parseInt(m.color.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
      const l = (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
      return l < 0.55 ? `color-mix(in oklab, ${m.color} 65%, white)` : m.color;
    }
    const pal = Array.isArray(s.palette) && s.palette.length ? s.palette : FC.DEF.palette;
    return pal[FC.hash((m.platform || '') + (m.login || m.name)) % pal.length];
  };
  FC.initial = (n) => (Array.from(String(n || '?').replace(/^@/, ''))[0] || '?').toUpperCase();
  const list = (s) => String(s || '').toLowerCase().split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

  // ---------- emotes (7TV, BTTV, FFZ; channel + global) ----------
  const EMO = new Map();
  let emoteRoom = '';
  async function j(url) { try { const r = await fetch(url); return r.ok ? r.json() : null; } catch { return null; } }
  FC.loadEmotes = async (roomId) => {
    if (!roomId || roomId === emoteRoom) return;
    emoteRoom = roomId;
    EMO.clear();
    const s = FC.s;
    const add = (name, url) => { if (name && url && !EMO.has(name)) EMO.set(name, url); };
    const jobs = [];
    if (s.e7tv) {
      jobs.push(j(`https://7tv.io/v3/users/twitch/${roomId}`).then((d) => (d?.emote_set?.emotes || []).forEach((e) => add(e.name, `https://cdn.7tv.app/emote/${e.id}/2x.webp`))));
      jobs.push(j('https://7tv.io/v3/emote-sets/global').then((d) => (d?.emotes || []).forEach((e) => add(e.name, `https://cdn.7tv.app/emote/${e.id}/2x.webp`))));
    }
    if (s.eBttv) {
      jobs.push(j(`https://api.betterttv.net/3/cached/users/twitch/${roomId}`).then((d) => [...(d?.channelEmotes || []), ...(d?.sharedEmotes || [])].forEach((e) => add(e.code, `https://cdn.betterttv.net/emote/${e.id}/2x`))));
      jobs.push(j('https://api.betterttv.net/3/cached/emotes/global').then((d) => (d || []).forEach((e) => add(e.code, `https://cdn.betterttv.net/emote/${e.id}/2x`))));
    }
    if (s.eFfz) {
      const ffz = (d) => Object.values(d?.sets || {}).forEach((set) => (set.emoticons || []).forEach((e) => add(e.name, e.urls?.['2'] || e.urls?.['1'])));
      jobs.push(j(`https://api.frankerfacez.com/v1/room/id/${roomId}`).then(ffz));
      jobs.push(j('https://api.frankerfacez.com/v1/set/global').then(ffz));
    }
    await Promise.all(jobs);
  };
  // Third-party emotes inside plain text parts.
  const withEmotes = (parts) => {
    if (!EMO.size) return parts;
    const out = [];
    for (const p of parts) {
      if (p.img) { out.push(p); continue; }
      const words = p.t.split(/(\s+)/);
      let buf = '';
      for (const w of words) {
        const u = EMO.get(w);
        if (u) { if (buf) out.push({ t: buf }); buf = ''; out.push({ img: u, alt: w }); } else buf += w;
      }
      if (buf) out.push({ t: buf });
    }
    return out;
  };

  // ---------- message pipeline ----------
  const subs = [];
  FC.onMessage = (f) => subs.push(f);
  FC.onClear = null;
  FC.emit = (m) => {
    const s = FC.s;
    const login = (m.login || m.name || '').toLowerCase();
    if (list(s.ignore).includes(login)) return;
    if (m.kind === 'chat') {
      if (s.hideBots && list(s.bots).includes(login)) return;
      if (s.hideCommands && /^\s*!/.test(m.text)) return;
      if (s.hideLinks && /https?:\/\/|www\./i.test(m.text)) return;
    }
    m.parts = withEmotes(m.parts || [{ t: m.text || '' }]);
    const low = (m.text || '').toLowerCase();
    m.mention = m.kind === 'chat' && [...(list(s.mentions).length ? list(s.mentions) : list(s.twitch)), ...list(s.hlWords)].some((w) => w && low.includes(w));
    m.own = !!m.own;
    subs.forEach((f) => f(m));
  };

  // ---------- local API (docs/API.md) ----------
  // A message as the API gives it out, and back: the dock and the featured source draw what the API sends.
  const PF = { tw: 'twitch', yt: 'youtube' };
  FC.apiMsg = (m) => ({
    type: 'message', id: m.id || '', platform: PF[m.platform] || m.platform || '', kind: m.kind || 'chat',
    user: { login: m.login || '', name: m.name || '', color: m.color || '', badges: m.badges || {} },
    text: m.text || '', parts: (m.parts || []).map((p) => (p.img ? { emote: p.img, alt: p.alt || '' } : { text: p.t || '' })),
    amount: m.amount || '', first: !!m.first, mention: !!m.mention, own: !!m.own, reply: m.reply || null,
    highlighted: !!m.highlighted, reward: !!m.reward, time: m.at || Date.now(),
  });
  FC.fromApi = (a) => ({
    platform: a.platform === 'youtube' ? 'yt' : 'tw', kind: a.kind || 'chat', id: a.id || '', login: a.user?.login || '', name: a.user?.name || '',
    color: a.user?.color || '', badges: a.user?.badges || {}, text: a.text || '',
    parts: (a.parts || [{ text: a.text || '' }]).map((p) => (p.emote ? { img: p.emote, alt: p.alt || '' } : { t: p.text || '' })),
    amount: a.amount || '', first: !!a.first, mention: !!a.mention, own: !!a.own, reply: a.reply || null,
    highlighted: !!a.highlighted, reward: !!a.reward, at: a.time || Date.now(),
  });
  FC.apiPush = (q, obj) => fetch('/api/push?' + q, { method: 'POST', body: JSON.stringify(obj) }).catch(() => {});

  // ---------- Twitch (anonymous, read-only IRC) ----------
  const unesc = (v) => v.replace(/\\(.)/g, (x, c) => (c === 's' ? ' ' : c === ':' ? ';' : c === 'r' ? '\r' : c === 'n' ? '\n' : c));
  function parse(line) {
    const m = { tags: {}, prefix: '', command: '', params: [], trailing: null };
    if (line[0] === '@') { const sp = line.indexOf(' '); for (const kv of line.slice(1, sp).split(';')) { const eq = kv.indexOf('='); if (eq > 0) m.tags[kv.slice(0, eq)] = unesc(kv.slice(eq + 1)); } line = line.slice(sp + 1); }
    if (line[0] === ':') { const sp = line.indexOf(' '); m.prefix = line.slice(1, sp); line = line.slice(sp + 1); }
    const ti = line.indexOf(' :'); if (ti >= 0) { m.trailing = line.slice(ti + 2); line = line.slice(0, ti); }
    m.params = line.split(' '); m.command = m.params.shift();
    return m;
  }
  function twParts(text, spec) {
    if (!spec) return [{ t: text }];
    const cps = Array.from(text), marks = [];
    for (const grp of spec.split('/')) { const [id, r] = grp.split(':'); if (!r) continue; for (const x of r.split(',')) { const [a, b] = x.split('-').map(Number); marks.push({ a, b, id }); } }
    marks.sort((x, y) => x.a - y.a);
    const out = []; let i = 0;
    for (const k of marks) { if (k.a < i) continue; if (k.a > i) out.push({ t: cps.slice(i, k.a).join('') }); out.push({ img: `https://static-cdn.jtvnw.net/emoticons/v2/${k.id}/default/dark/2.0`, alt: cps.slice(k.a, k.b + 1).join('') }); i = k.b + 1; }
    if (i < cps.length) out.push({ t: cps.slice(i).join('') });
    return out;
  }
  FC.status = { tw: 'off', yt: 'off' };
  const statusSubs = [];
  FC.onStatus = (f) => statusSubs.push(f);
  const setStatus = (k, v, note = '') => {
    FC.status[k] = v; FC.status[k + 'Note'] = note;
    try { localStorage.setItem('fc.status.' + k, v + '|' + note); } catch { /* storage unavailable */ }
    statusSubs.forEach((f) => f());
  };
  // A platform's state in words, as the settings page and the tray tip show it.
  FC.statusText = (v, note) => FC.t({ live: 'на зв’язку', wait: note || 'зачекай', error: note || 'помилка', off: 'вимкнено' }[v] || '');

  let tw = null;
  FC.twitch = (channel) => {
    if (tw) { tw.close(); tw = null; }
    channel = String(channel || '').toLowerCase().replace(/^#|^@/, '').trim();
    if (!channel || !FC.s.twitchOn) { setStatus('tw', 'off'); return; }
    let ws, backoff = 1000, alive = Date.now(), dead = false, timer, joined;
    const own = channel;
    const connect = () => {
      setStatus('tw', 'wait');
      ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
      ws.onopen = () => {
        backoff = 1000; ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands'); ws.send('PASS SCHMOOPIIE'); ws.send('NICK justinfan' + (10000 + Math.floor(Math.random() * 80000))); ws.send('JOIN #' + channel);
        // Twitch stays silent on a channel that doesn't exist (or is banned): no ROOMSTATE comes.
        clearTimeout(joined);
        joined = setTimeout(() => { if (FC.status.tw !== 'live') setStatus('tw', 'error', 'канал не знайдено'); }, 10e3);
      };
      ws.onmessage = (e) => { alive = Date.now(); for (const l of String(e.data).split('\r\n')) if (l) handle(parse(l)); };
      ws.onclose = () => { clearTimeout(joined); if (dead) return; setStatus('tw', 'wait', 'перепідключення'); timer = setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 30000); };
      ws.onerror = () => ws.close();
    };
    const user = (m) => { const login = m.tags.login || m.prefix.split('!')[0] || ''; return { login, name: m.tags['display-name'] || login, color: m.tags.color || '' }; };
    const handle = (m) => {
      const t = m.tags;
      switch (m.command) {
        case 'PING': ws.send('PONG :' + (m.trailing || 'tmi.twitch.tv')); break;
        case 'RECONNECT': ws.close(); break;
        case 'ROOMSTATE': setStatus('tw', 'live', '#' + channel); FC.roomId = t['room-id']; FC.loadEmotes(t['room-id']); break;
        case 'PRIVMSG': {
          let text = m.trailing || '';
          if (text.startsWith('\x01ACTION ')) text = text.slice(8).replace(/\x01$/, '');
          const b = t.badges || '';
          const u = user(m);
          const parts = twParts(text, t.emotes);
          // A reply starts with "@parent "; the parent is shown on its own line instead.
          const rp = t['reply-parent-display-name'] || t['reply-parent-user-login'] || '';
          const reply = rp ? { name: rp, text: t['reply-parent-msg-body'] || '' } : null;
          if (reply && parts[0] && !parts[0].img) {
            const lead = parts[0].t.match(/^@(\S+)\s*/);
            if (lead && [t['reply-parent-display-name'], t['reply-parent-user-login']].some((x) => x && x.toLowerCase() === lead[1].toLowerCase())) parts[0] = { t: parts[0].t.slice(lead[0].length) };
          }
          const mid = t['msg-id'] || '';
          FC.emit({
            platform: 'tw', kind: t.bits ? 'bits' : 'chat', id: t.id, ...u, text, parts, reply,
            first: t['first-msg'] === '1', own: u.login === own,
            badges: { owner: /broadcaster\//.test(b), mod: t.mod === '1', vip: /vip\//.test(b), sub: t.subscriber === '1' },
            amount: t.bits ? FC.t('{n} бітів', { n: t.bits }) : '',
            // Channel points: "Highlight My Message" and message effects; a custom reward with text.
            highlighted: mid === 'highlighted-message' || mid === 'animated-message' || mid === 'gigantified-emote-message',
            reward: !!t['custom-reward-id'],
          });
          break;
        }
        case 'USERNOTICE': {
          const kind = t['msg-id'] || '', u = user(m);
          const months = +t['msg-param-cumulative-months'] || 0, n = +t['msg-param-mass-gift-count'] || 0, viewers = +t['msg-param-viewerCount'] || 0;
          const note = kind === 'raid' ? FC.t('рейд · {n} глядачів', { n: viewers }) : /mystery/.test(kind) ? FC.t('дарує {n} підписок', { n }) : /gift/.test(kind) ? FC.t('дарує підписку {name}', { name: t['msg-param-recipient-display-name'] || '' }) : /sub/.test(kind) ? (months > 1 ? FC.t('підписка · {n} міс.', { n: months }) : FC.t('нова підписка')) : '';
          if (!note || t['msg-param-community-gift-id'] && /^subgift|^anonsubgift/.test(kind)) break;
          const text = m.trailing || '';
          FC.emit({ platform: 'tw', kind: kind === 'raid' ? 'raid' : 'sub', id: t.id, ...u, text, parts: twParts(text, t.emotes), amount: note, badges: {} });
          break;
        }
        case 'CLEARCHAT': FC.onClear && FC.onClear({ login: m.trailing || '' }); break;
        case 'CLEARMSG': FC.onClear && FC.onClear({ id: t['target-msg-id'] }); break;
      }
    };
    const watch = setInterval(() => { if (ws && ws.readyState === 1 && Date.now() - alive > 6 * 60e3) ws.close(); }, 30e3);
    connect();
    tw = { close: () => { dead = true; clearTimeout(timer); clearTimeout(joined); clearInterval(watch); try { ws.close(); } catch { /* closed */ } setStatus('tw', 'off'); } };
  };

  // ---------- YouTube (live chat without keys, through the host proxy) ----------
  let yt = null;
  const proxy = (u, body) => fetch('/proxy?u=' + encodeURIComponent(u), body ? { method: 'POST', body: JSON.stringify(body) } : {}).then((r) => r.text());
  const ytLiveUrl = (v) => {
    v = String(v || '').trim();
    if (!v) return '';
    let m = v.match(/(?:v=|youtu\.be\/|\/live\/)([\w-]{11})/);
    if (m) return `https://www.youtube.com/watch?v=${m[1]}`;
    if (/^[\w-]{11}$/.test(v)) return `https://www.youtube.com/watch?v=${v}`;
    m = v.match(/(UC[\w-]{22})/);
    if (m) return `https://www.youtube.com/channel/${m[1]}/live`;
    m = v.match(/@([\w.\-]+)/) || v.match(/^([\w.\-]+)$/);
    return m ? `https://www.youtube.com/@${m[1]}/live` : '';
  };
  const runsParts = (runs) => (runs || []).map((r) => (r.text != null ? { t: r.text } : r.emoji ? { img: r.emoji.image?.thumbnails?.slice(-1)[0]?.url, alt: r.emoji.shortcuts?.[0] || '' } : { t: '' }));
  const runsText = (runs) => (runs || []).map((r) => r.text ?? r.emoji?.shortcuts?.[0] ?? '').join('');

  FC.youtube = (input) => {
    if (yt) { yt.stop(); yt = null; }
    const live = ytLiveUrl(input);
    if (!live || !FC.s.ytOn) { setStatus('yt', 'off'); return; }
    let stop = false, timer = null, seen = new Set();
    const later = (ms, f) => { if (!stop) timer = setTimeout(f, ms); };
    async function find() {
      setStatus('yt', 'wait', 'шукаю ефір');
      try {
        const res = await fetch('/proxy?u=' + encodeURIComponent(live));
        if (res.status === 404) { setStatus('yt', 'error', 'канал не знайдено'); return later(300e3, find); }
        const html = await res.text();
        const vid = (html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/) || [])[1];
        const key = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1];
        const ver = (html.match(/"clientVersion":"([\d.]+)"/) || [])[1] || '2.20241101.00.00';
        if (!vid || !key || !/"isLive(Now|Content)":true/.test(html)) { setStatus('yt', 'wait', 'не в ефірі'); return later(60e3, find); }
        const chat = await proxy(`https://www.youtube.com/live_chat?is_popout=1&v=${vid}`);
        const cont = (chat.match(/"continuation":"([^"]+)"/) || [])[1];
        if (!cont) { setStatus('yt', 'wait', 'чат вимкнено'); return later(60e3, find); }
        setStatus('yt', 'live', vid);
        poll(key, ver, cont, true);
      } catch { setStatus('yt', 'error', 'немає зв’язку'); later(30e3, find); }
    }
    async function poll(key, ver, cont, first) {
      if (stop) return;
      let d;
      try { d = JSON.parse(await proxy(`https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${key}&prettyPrint=false`, { context: { client: { clientName: 'WEB', clientVersion: ver } }, continuation: cont })); }
      catch { return later(5000, () => poll(key, ver, cont, false)); }
      const c = d?.continuationContents?.liveChatContinuation;
      if (!c) { setStatus('yt', 'wait', 'ефір завершено'); return later(30e3, find); }
      for (const a of c.actions || []) {
        const it = a.addChatItemAction?.item;
        if (!it) continue;
        const r = it.liveChatTextMessageRenderer || it.liveChatPaidMessageRenderer || it.liveChatMembershipItemRenderer || it.liveChatPaidStickerRenderer;
        if (!r || seen.has(r.id)) continue;
        seen.add(r.id);
        if (first) continue; // backlog when the chat opens: not replayed
        const tips = (r.authorBadges || []).map((b) => b.liveChatAuthorBadgeRenderer?.tooltip || '').join(' ').toLowerCase();
        const kind = it.liveChatTextMessageRenderer ? 'chat' : it.liveChatMembershipItemRenderer ? 'member' : 'superchat';
        const runs = r.message?.runs || r.headerSubtext?.runs || [];
        FC.emit({
          platform: 'yt', kind, id: r.id, login: r.authorExternalChannelId || r.authorName?.simpleText, name: (r.authorName?.simpleText || 'YouTube').replace(/^@/, ''),
          text: runsText(runs), parts: runsParts(runs),
          badges: { owner: /owner|власник/.test(tips), mod: /moderator|модератор/.test(tips), member: /member|спонсор|учасник/.test(tips), vip: false, sub: false },
          amount: r.purchaseAmountText?.simpleText || (kind === 'member' ? FC.t('спонсорство') : ''),
        });
      }
      if (seen.size > 2000) seen = new Set([...seen].slice(-500));
      const nx = c.continuations?.[0] || {};
      const k = nx.invalidationContinuationData || nx.timedContinuationData || nx.reloadContinuationData;
      if (!k?.continuation) { setStatus('yt', 'wait', 'ефір завершено'); return later(30e3, find); }
      later(Math.min(5000, Math.max(1500, +k.timeoutMs || 3000)), () => poll(key, ver, k.continuation, false));
    }
    find();
    yt = { stop: () => { stop = true; clearTimeout(timer); setStatus('yt', 'off'); } };
  };

  // ---------- sounds ----------
  let ac = null;
  const tone = (notes, wave = 'sine', gap = 0.12, dur = 1.2, vol = 0.5) => {
    ac = ac || new AudioContext();
    const t0 = ac.currentTime + 0.02;
    notes.forEach((f, i) => {
      const t = t0 + i * gap;
      for (const [mul, g0, d0] of [[1, 1, dur], [2.01, 0.15, dur * 0.4]]) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = wave; o.frequency.value = f * mul;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * g0, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + d0);
        o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d0 + 0.05);
      }
    });
  };
  FC.FONTS = {
    plex: ['IBM Plex Mono', 'Моноширинний (Plex)'], jet: ['JetBrains Mono', 'JetBrains Mono'], inter: ['Inter', 'Inter'], onest: ['Onest', 'Onest'],
    geo: ['Geologica', 'Geologica'], oswald: ['Oswald', 'Oswald (вузький)'], roboto: ['Roboto Condensed', 'Roboto Condensed'], system: ['Segoe UI', 'Як у Windows'], own: ['', 'Свій шрифт…'],
  };
  FC.SOUNDS = {
    kalimba: { name: 'Калімба', play: (v) => tone([1319, 1760], 'sine', 0.11, 1.1, v) },
    bell: { name: 'Дзвіночок', play: (v) => tone([988, 1319, 1760], 'sine', 0.1, 1.4, v) },
    drop: { name: 'Крапля', play: (v) => tone([1760, 2349], 'triangle', 0.06, 0.5, v) },
    pop: { name: 'Клац', play: (v) => tone([660], 'square', 0, 0.12, v * 0.35) },
    soft: { name: 'М’яка нота', play: (v) => tone([784], 'sine', 0, 1.6, v) },
    fanfare: { name: 'Фанфари', play: (v) => tone([784, 988, 1175, 1568], 'triangle', 0.09, 1.0, v) },
  };
  const audioEls = {};
  FC.play = (event, force) => {
    const s = FC.s, name = s.snd[event], v = (s.vol[event] ?? 0.6) * s.volume;
    if (!name || name === 'off' || !v) return;
    try {
      if (name === 'custom') {
        const src = localStorage.getItem('fc.snd.' + event);
        if (!src) return;
        const a = audioEls[event] || (audioEls[event] = new Audio());
        if (a.src !== src) a.src = src;
        a.volume = Math.min(1, v); a.currentTime = 0; a.play().catch(() => {});
      } else FC.SOUNDS[name]?.play(v);
    } catch { /* audio unavailable */ }
    void force;
  };

  // ---------- relay to the OBS scenes ----------
  FC.relay = (m) => {
    if (!FC.s.relay) return;
    const { platform, kind, id, login, name, color, text, parts, first, badges, amount } = m;
    fetch('/push', { method: 'POST', body: JSON.stringify({ platform, kind, id, login, name, color, text, parts, first, badges, amount }) }).catch(() => {});
  };
})();
