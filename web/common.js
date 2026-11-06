// Shared by the overlay and the settings page: settings store, language, Twitch (anonymous IRC), YouTube (live
// chat through the host's /proxy), Kick (public Pusher feed), 7TV / BTTV / FFZ emotes, name palettes, sounds, relay
// to the OBS scenes.
(() => {
  const FC = (window.FC = {});
  const KEY = 'fc.settings.v1';

  FC.DEF = {
    twitch: '', twitchOn: true, youtube: '', ytOn: true, kick: '', kickOn: true, lang: 'auto',
    // Look
    // badgeStyle: 'img' — the platforms' own badge pictures (Twitch), 'text' — short words; stv: 7TV paints and badges
    style: 'cards', font: 17, emoteSize: 1.6, letter: true, showPlatform: true, showTime: false, showBadges: true, badgeStyle: 'img', stv: true,
    fontName: 'plex', fontText: 'plex', fontNameOwn: '', fontTextOwn: '', nameUpper: true, nameWeight: 500, textWeight: 400, outline: 0.6,
    accent: '#e8e8e8', text: '#ececec',
    // Name colours: 'brand' = from the palette, 'twitch' = the viewer's Twitch colour, 'mono' = accent
    nameMode: 'brand', palette: ['#3cc6dc', '#ff7a6b', '#a98ef0'], palGen: 6,
    // Background: transparency 0 = solid, 1 = fully transparent
    cardColor: '#121212', cardT: 0.18, panelColor: '#121212', panelT: 1, cardRadius: 0, gap: 6,
    // Top line
    showHeader: true, hdrTw: true, hdrYt: true, hdrKk: true, hdrViewers: true, hdrUptime: true, hdrClock: false,
    hdrSize: 13, hdrColor: '#e6e6e6', hdrT: 0.45,
    // Messages
    // idleHide: the whole chat hides after that many quiet seconds and comes back with a new message (0 — never)
    maxMsgs: 12, fade: 0, idleHide: 0, newestTop: false,
    // Featured message (the /obs?featured source): seconds on screen (0 — until taken off), size against the chat
    featSec: 10, featScale: 1.4,
    // Alerts (the /obs?alerts source): 'card' in the middle or 'bar' from the top, seconds each
    alertStyle: 'card', alertSec: 6, hideBots: true, hideCommands: false, hideLinks: false, showReplies: true,
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
    snd: { msg: 'kalimba', first: 'bell', mention: 'ping', event: 'arp' },
    vol: { msg: 0.5, first: 0.8, mention: 0.9, event: 0.8 },
    // Scenes
    relay: true,
    // Window theme (settings, dock): a key of FC.THEMES; uiBg / uiAccent for «custom»
    uiTheme: 'hole', uiBg: '#14161a', uiAccent: '#7ee0c3',
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
    const out = { ...FC.DEF, ...s, snd: { ...FC.DEF.snd, ...(s.snd || {}) }, vol: { ...FC.DEF.vol, ...(s.vol || {}) } };
    // Sounds that are gone (0.1.5 dropped the harsh ones) fall back to the defaults.
    for (const ev of Object.keys(out.snd)) if (!['off', 'custom'].includes(out.snd[ev]) && FC.SOUNDS && !FC.SOUNDS[out.snd[ev]]) out.snd[ev] = FC.DEF.snd[ev];
    return out;
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

  // ---------- window themes (settings, dock; the chat has colours of its own) ----------
  // The same family as Arcmix. bg — page, surf — fields, surf2 — buttons, fg / dim — text, hi — accent, ink — text on
  // the accent. «Same as Windows» and OLED take the Windows accent (host /state), «Same as Windows» also its mode.
  FC.THEMES = {
    hole: ['Чорна діра', { bg: '#0f0f10', surf: '#161618', surf2: '#1d1d20', fg: '#ececec', dim: '#8e8e93', hi: '#e8e8ea', ink: '#121212' }],
    win: ['Як у Windows', null],
    black: ['Чорна (OLED)', { bg: '#000000', surf: '#0d0d0f', surf2: '#151518', fg: '#f2f2f2', dim: '#8a8a90', hi: 'accent', ink: '#ffffff' }],
    pink: ['Туманність', { bg: '#0a0614', surf: '#130b22', surf2: '#1d1233', fg: '#f1e9ff', dim: '#9b8bb8', hi: '#ff2e97', ink: '#ffffff',
      fx: 'radial-gradient(120% 45% at 100% 0%, rgba(160, 75, 255, .16), transparent 60%), radial-gradient(90% 40% at 0% 100%, rgba(25, 211, 255, .08), transparent 60%)' }],
    blue: ['Нептун', { bg: '#0e141c', surf: '#151e2a', surf2: '#1b2635', fg: '#e6eef8', dim: '#8a9bb0', hi: '#6cb8ff', ink: '#0e141c' }],
    gray: ['Місяць', { bg: '#151618', surf: '#1d1e21', surf2: '#25262a', fg: '#ececee', dim: '#8f9196', hi: '#d3d6dd', ink: '#151618' }],
    twitch: ['Twitch', { bg: '#0e0e10', surf: '#18181b', surf2: '#26262c', fg: '#efeff1', dim: '#adadb8', hi: '#bf94ff', ink: '#ffffff' }],
    discord: ['Discord', { bg: '#121214', surf: '#1a1a1e', surf2: '#28282d', fg: '#f2f3f5', dim: '#949ba4', hi: '#5865f2', ink: '#ffffff' }],
    custom: ['Власна', null],
  };
  const lum = (hex) => { const n = parseInt(String(hex || '#000000').slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
  // A theme's colours; win — { accent, light } from the host.
  FC.themeColors = (key, win = {}) => {
    const s = FC.s, accent = /^#[0-9a-f]{6}$/i.test(win.accent || '') ? win.accent : '#4cc2ff';
    if (key === 'win') {
      return win.light
        ? { bg: '#f3f3f3', surf: '#ffffff', surf2: '#fbfbfb', fg: '#1b1b1b', dim: '#5f5f5f', hi: `color-mix(in srgb, ${accent} 78%, #000)`, ink: '#ffffff', light: true }
        : { bg: '#202020', surf: '#2b2b2b', surf2: '#2d2d2d', fg: '#ffffff', dim: '#a6a6a6', hi: accent, ink: lum(accent) > 0.55 ? '#000000' : '#ffffff' };
    }
    if (key === 'custom') {
      // Own background and accent: text, fields and buttons follow the background's lightness.
      const bg = /^#[0-9a-f]{6}$/i.test(s.uiBg || '') ? s.uiBg : '#14161a', hi = /^#[0-9a-f]{6}$/i.test(s.uiAccent || '') ? s.uiAccent : '#7ee0c3';
      const light = lum(bg) > 0.55, fg = light ? '#1b1b1b' : '#ececec';
      return { bg, surf: `color-mix(in srgb, ${fg} 5%, ${bg})`, surf2: `color-mix(in srgb, ${fg} 9%, ${bg})`, fg, dim: `color-mix(in srgb, ${fg} 58%, ${bg})`, hi, ink: lum(hi) > 0.55 ? '#121212' : '#ffffff', light };
    }
    const t = { ...(FC.THEMES[key] || FC.THEMES.hole)[1] };
    if (t.hi === 'accent') { t.hi = accent; t.ink = lum(accent) > 0.55 ? '#000000' : '#ffffff'; }
    return t;
  };
  // Puts the theme on the page; the colours of the title bar are returned for the host (plain hex only).
  FC.applyTheme = (win = {}) => {
    const c = FC.themeColors(FC.s.uiTheme || 'hole', win), st = document.body.style;
    for (const [k, v] of Object.entries({ sbg: c.bg, surf: c.surf, surf2: c.surf2, fg: c.fg, dim: c.dim, hi: c.hi, ink: c.ink, fx: c.fx || 'none' })) st.setProperty('--' + k, v);
    document.body.classList.toggle('light', !!c.light);
    return { bg: c.bg.startsWith('#') ? c.bg : (c.light ? '#f3f3f3' : '#14161a'), fg: c.light ? '#1b1b1b' : c.fg.startsWith('#') ? c.fg : '#ececec', light: !!c.light };
  };

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
  // Kick's channel 7TV set (7TV keeps Kick channels apart from Twitch ones); the global set is in EMO.
  const KEMO = new Map();
  FC.loadKickEmotes = async (userId) => {
    KEMO.clear();
    if (!userId || !FC.s.e7tv) return;
    const d = await j(`https://7tv.io/v3/users/kick/${userId}`);
    (d?.emote_set?.emotes || []).forEach((e) => KEMO.set(e.name, `https://cdn.7tv.app/emote/${e.id}/2x.webp`));
  };
  // Third-party emotes inside plain text parts; Kick messages look in the Kick set first.
  const withEmotes = (parts, kick) => {
    if (!EMO.size && !(kick && KEMO.size)) return parts;
    const out = [];
    for (const p of parts) {
      if (p.img) { out.push(p); continue; }
      const words = p.t.split(/(\s+)/);
      let buf = '';
      for (const w of words) {
        const u = (kick && KEMO.get(w)) || EMO.get(w);
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
    m.parts = withEmotes(m.parts || [{ t: m.text || '' }], m.platform === 'kk');
    const low = (m.text || '').toLowerCase();
    m.mention = m.kind === 'chat' && [...(list(s.mentions).length ? list(s.mentions) : list(s.twitch)), ...list(s.hlWords)].some((w) => w && low.includes(w));
    m.own = !!m.own;
    subs.forEach((f) => f(m));
  };

  // ---------- local API (docs/API.md) ----------
  // A message as the API gives it out, and back: the dock and the featured source draw what the API sends.
  const PF = { tw: 'twitch', yt: 'youtube', kk: 'kick' };
  FC.apiMsg = (m) => ({
    type: 'message', id: m.id || '', platform: PF[m.platform] || m.platform || '', kind: m.kind || 'chat',
    user: { login: m.login || '', name: m.name || '', color: m.color || '', id: m.uid || '', badges: m.badges || {}, badgeTags: m.badgeTags || '', badgeImgs: m.badgeImgs || [] },
    text: m.text || '', parts: (m.parts || []).map((p) => (p.img ? { emote: p.img, alt: p.alt || '' } : { text: p.t || '' })),
    amount: m.amount || '', first: !!m.first, mention: !!m.mention, own: !!m.own, reply: m.reply || null,
    highlighted: !!m.highlighted, reward: !!m.reward, time: m.at || Date.now(),
  });
  FC.fromApi = (a) => ({
    platform: { youtube: 'yt', kick: 'kk' }[a.platform] || 'tw', kind: a.kind || 'chat', id: a.id || '', login: a.user?.login || '', name: a.user?.name || '',
    color: a.user?.color || '', uid: a.user?.id || '', badges: a.user?.badges || {}, badgeTags: a.user?.badgeTags || '', badgeImgs: a.user?.badgeImgs || [], text: a.text || '',
    parts: (a.parts || [{ text: a.text || '' }]).map((p) => (p.emote ? { img: p.emote, alt: p.alt || '' } : { t: p.text || '' })),
    amount: a.amount || '', first: !!a.first, mention: !!a.mention, own: !!a.own, reply: a.reply || null,
    highlighted: !!a.highlighted, reward: !!a.reward, at: a.time || Date.now(),
  });
  FC.apiPush = (q, obj) => fetch('/api/push?' + q, { method: 'POST', body: JSON.stringify(obj) }).catch(() => {});

  // ---------- badge pictures (Twitch, through ivr.fi: global and the channel's own) and 7TV paints / badges ----------
  const BADGES = { global: null, chan: '', set: new Map() };
  const badgeSets = (list, into) => (Array.isArray(list) ? list : []).forEach((b) => (b.versions || []).forEach((v) => into.set(b.set_id + '/' + v.id, { src: v.image_url_2x, title: v.title || b.set_id })));
  FC.loadBadges = async (channel) => {
    if (!BADGES.global) { BADGES.global = new Map(); badgeSets(await j('https://api.ivr.fi/v2/twitch/badges/global'), BADGES.global); }
    if (channel && channel !== BADGES.chan) { BADGES.chan = channel; BADGES.set = new Map(); badgeSets(await j('https://api.ivr.fi/v2/twitch/badges/channel?login=' + encodeURIComponent(channel)), BADGES.set); }
  };
  // The pictures of a message's badges: Twitch from its badge tags ("moderator/1,subscriber/12"), YouTube's member badge.
  FC.badgeImgs = (m) => {
    if (m.badgeImgs?.length) return m.badgeImgs;
    return String(m.badgeTags || '').split(',').filter(Boolean).map((k) => BADGES.set.get(k) || BADGES.global?.get(k)).filter(Boolean);
  };
  // 7TV: a person's paint (a gradient or a picture for the name) and badge, by platform user id; cached, 404 — none.
  const STV = new Map(), STV_COS = new Map();
  const rgba = (c) => { c >>>= 0; return `rgba(${c >>> 24},${(c >>> 16) & 255},${(c >>> 8) & 255},${((c & 255) / 255).toFixed(3)})`; };
  const paintCss = (p) => {
    const stops = (p.stops || []).map((x) => `${rgba(x.color)} ${(x.at * 100).toFixed(1)}%`).join(', ');
    const image = p.function === 'URL' ? `url("${p.image_url}")`
      : p.function === 'RADIAL_GRADIENT' ? `${p.repeat ? 'repeating-' : ''}radial-gradient(${p.shape || 'circle'}, ${stops})`
        : `${p.repeat ? 'repeating-' : ''}linear-gradient(${p.angle || 0}deg, ${stops})`;
    const filter = (p.shadows || []).map((x) => `drop-shadow(${x.x_offset}px ${x.y_offset}px ${x.radius}px ${rgba(x.color)})`).join(' ');
    return { image, filter, url: p.function === 'URL' };
  };
  async function cosmetics(ids) {
    const need = ids.filter((id) => id && !STV_COS.has(id));
    if (need.length) {
      try {
        const q = 'query($l:[ObjectID!]){cosmetics(list:$l){paints{id function color angle shape image_url repeat stops{at color} shadows{x_offset y_offset radius color}} badges{id tooltip host{url}}}}';
        const r = await fetch('https://7tv.io/v3/gql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, variables: { l: need } }) }).then((x) => x.json());
        for (const p of r?.data?.cosmetics?.paints || []) STV_COS.set(p.id, { paint: paintCss(p) });
        for (const b of r?.data?.cosmetics?.badges || []) STV_COS.set(b.id, { badge: { src: 'https:' + b.host.url + '/2x.webp', title: b.tooltip || '7TV' } });
      } catch { /* 7TV unavailable */ }
      for (const id of need) if (!STV_COS.has(id)) STV_COS.set(id, {});
    }
    return ids.map((id) => STV_COS.get(id) || {});
  }
  const STV_PF = { tw: 'twitch', yt: 'youtube', kk: 'kick' };
  FC.stv = (m) => {
    const key = (m.platform || '') + ':' + (m.uid || '');
    if (!m.uid || !STV_PF[m.platform]) return Promise.resolve({});
    if (!STV.has(key)) {
      STV.set(key, (async () => {
        const u = await j(`https://7tv.io/v3/users/${STV_PF[m.platform]}/${encodeURIComponent(m.uid)}`);
        const st = u?.user?.style || {};
        const [p, b] = await cosmetics([st.paint_id, st.badge_id]);
        return { paint: p?.paint || null, badge: b?.badge || null };
      })());
      if (STV.size > 3000) STV.delete(STV.keys().next().value);
    }
    return STV.get(key);
  };

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
  FC.status = { tw: 'off', yt: 'off', kk: 'off' };
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
    const user = (m) => { const login = m.tags.login || m.prefix.split('!')[0] || ''; return { login, name: m.tags['display-name'] || login, color: m.tags.color || '', uid: m.tags['user-id'] || '', badgeTags: m.tags.badges || '' }; };
    const handle = (m) => {
      const t = m.tags;
      switch (m.command) {
        case 'PING': ws.send('PONG :' + (m.trailing || 'tmi.twitch.tv')); break;
        case 'RECONNECT': ws.close(); break;
        case 'ROOMSTATE': setStatus('tw', 'live', '#' + channel); FC.roomId = t['room-id']; FC.loadEmotes(t['room-id']); FC.loadBadges(channel); break;
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
        // A channel member's badge is a picture of the channel's own (customThumbnail).
        const memberImg = (r.authorBadges || []).map((b) => b.liveChatAuthorBadgeRenderer?.customThumbnail?.thumbnails?.slice(-1)[0]?.url).find(Boolean) || '';
        const kind = it.liveChatTextMessageRenderer ? 'chat' : it.liveChatMembershipItemRenderer ? 'member' : 'superchat';
        const runs = r.message?.runs || r.headerSubtext?.runs || [];
        FC.emit({
          platform: 'yt', kind, id: r.id, login: r.authorExternalChannelId || r.authorName?.simpleText, name: (r.authorName?.simpleText || 'YouTube').replace(/^@/, ''),
          text: runsText(runs), parts: runsParts(runs),
          badges: { owner: /owner|власник/.test(tips), mod: /moderator|модератор/.test(tips), member: /member|спонсор|учасник/.test(tips), vip: false, sub: false },
          uid: r.authorExternalChannelId || '', badgeImgs: memberImg ? [{ src: memberImg, title: FC.t('спонсор') }] : [],
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

  // ---------- Kick (the public Pusher feed of the site's own chat, read-only, no login) ----------
  // Off for now (FC.KICK): the public key answers "not in this cluster" since 11.2026, and Kick's own pages now take
  // their connection from an internal API. The settings, the dock and the overlay show nothing of Kick while off.
  FC.KICK = false;
  // The chatroom id is in the channel's data (kick.com/api/v2/channels/<slug>): read by the page itself, or through
  // the host when Kick refuses the page.
  // Kick has moved its public Pusher key between clusters ("not in this cluster", 4001): the known key / cluster pairs
  // are tried in turn and the one that worked is remembered.
  const KICK_APPS = [['32cbd69e4b950bf97679', 'us2'], ['32cbd69e4b950bf97679', 'mt1'], ['32cbd69e4b950bf97679', 'us3'], ['32cbd69e4b950bf97679', 'eu'],
    ['eb1d5f283081a78b932c', 'us2'], ['eb1d5f283081a78b932c', 'mt1']];
  let kickApp = 0;
  try { kickApp = Math.min(KICK_APPS.length - 1, +localStorage.getItem('fc.kickApp') || 0); } catch { /* storage unavailable */ }
  const kickWs = () => { const [key, cl] = KICK_APPS[kickApp]; return `wss://ws-${cl}.pusher.com/app/${key}?protocol=7&client=js&version=8.4.0&flash=false`; };
  // "[emote:37226:KEKW]" in the text is a Kick emote.
  const kickParts = (text) => {
    const out = [];
    let i = 0;
    for (const m of text.matchAll(/\[emote:(\d+):([^\]]*)\]/g)) {
      if (m.index > i) out.push({ t: text.slice(i, m.index) });
      out.push({ img: `https://files.kick.com/emotes/${m[1]}/fullsize`, alt: m[2] });
      i = m.index + m[0].length;
    }
    if (i < text.length) out.push({ t: text.slice(i) });
    return out;
  };
  const kickText = (text) => String(text || '').replace(/\[emote:\d+:([^\]]*)\]/g, '$1');
  async function kickChannel(slug) {
    const url = `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`;
    for (const get of [() => fetch(url), () => fetch('/proxy?u=' + encodeURIComponent(url))]) {
      try {
        const r = await get();
        if (r.status === 404) return null;
        if (r.ok) { const d = await r.json(); if (d?.chatroom?.id) return d; }
      } catch { /* the next way */ }
    }
    throw new Error('lookup');
  }

  let kk = null;
  FC.kick = (channel) => {
    if (kk) { kk.close(); kk = null; }
    channel = String(channel || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?kick\.com\//, '').replace(/^@/, '').split(/[/?#]/)[0];
    if (!channel || !FC.s.kickOn) { setStatus('kk', 'off'); return; }
    let ws, dead = false, timer, backoff = 1000, room = 0;
    const own = channel;
    const lookup = async () => {
      setStatus('kk', 'wait');
      let d;
      try { d = await kickChannel(channel); } catch { if (!dead) { setStatus('kk', 'error', 'немає зв’язку'); timer = setTimeout(lookup, 30e3); } return; }
      if (dead) return;
      if (!d) { setStatus('kk', 'error', 'канал не знайдено'); return; }
      room = d.chatroom.id;
      FC.loadKickEmotes(d.user_id);
      connect();
    };
    const connect = () => {
      ws = new WebSocket(kickWs());
      ws.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch { /* not JSON */ } };
      ws.onclose = (e) => {
        if (dead) return;
        // A key / cluster Kick doesn't serve (4000–4099 are Pusher's "don't retry" codes): the next pair, at once.
        if (e.code >= 4000 && e.code < 4100 && kickApp < KICK_APPS.length - 1) { kickApp++; connect(); return; }
        setStatus('kk', 'wait', 'перепідключення'); timer = setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 30000);
      };
      ws.onerror = () => ws.close();
    };
    // Pusher sends each event's data as a JSON string.
    const data = (m) => { try { return typeof m.data === 'string' ? JSON.parse(m.data) : m.data || {}; } catch { return {}; } };
    const emit = (kind, d, login, amount, text = '') => FC.emit({ platform: 'kk', kind, id: 'kk' + kind + Date.now(), login, name: login || 'Kick', text, parts: [{ t: text }], amount, badges: {} });
    const handle = (m) => {
      const ev = m.event || '', d = data(m);
      switch (ev) {
        case 'pusher:connection_established': backoff = 1000; ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: `chatrooms.${room}.v2` } })); break;
        case 'pusher:ping': ws.send(JSON.stringify({ event: 'pusher:pong', data: {} })); break;
        case 'pusher_internal:subscription_succeeded':
          setStatus('kk', 'live', channel);
          try { localStorage.setItem('fc.kickApp', kickApp); } catch { /* storage unavailable */ }
          break;
        case 'App\\Events\\ChatMessageEvent': {
          const s = d.sender || {}, idn = s.identity || {}, bd = (idn.badges || []).map((b) => b.type), login = s.slug || s.username || '';
          const meta = d.metadata || {};
          const reply = d.type === 'reply' && meta.original_sender ? { name: meta.original_sender.username || '', text: kickText(meta.original_message?.content) } : null;
          FC.emit({
            platform: 'kk', kind: 'chat', id: d.id, login, name: s.username || login, color: idn.color || '', uid: String(s.id || ''), text: kickText(d.content), parts: kickParts(String(d.content || '')), reply,
            own: login.toLowerCase() === own,
            badges: { owner: bd.includes('broadcaster'), mod: bd.includes('moderator'), vip: bd.includes('vip') || bd.includes('og'), sub: bd.includes('subscriber') || bd.includes('founder') },
          });
          break;
        }
        case 'App\\Events\\MessageDeletedEvent': if (FC.onClear) FC.onClear({ id: d.message?.id }); break;
        case 'App\\Events\\UserBannedEvent': if (FC.onClear) FC.onClear({ login: d.user?.slug || d.user?.username || '' }); break;
        case 'App\\Events\\ChatroomClearEvent': if (FC.onClear) FC.onClear({}); break;
        case 'App\\Events\\SubscriptionEvent': emit('sub', d, d.username || '', d.months > 1 ? FC.t('підписка · {n} міс.', { n: d.months }) : FC.t('нова підписка')); break;
        case 'App\\Events\\GiftedSubscriptionsEvent': {
          const to = d.gifted_usernames || [];
          emit('sub', d, d.gifter_username || '', to.length > 1 ? FC.t('дарує {n} підписок', { n: to.length }) : FC.t('дарує підписку {name}', { name: to[0] || '' }));
          break;
        }
        case 'App\\Events\\StreamHostEvent': emit('raid', d, d.host_username || '', FC.t('рейд · {n} глядачів', { n: d.number_viewers || 0 }), d.optional_message || ''); break;
      }
    };
    lookup();
    kk = { close: () => { dead = true; clearTimeout(timer); try { if (ws) ws.close(); } catch { /* closed */ } setStatus('kk', 'off'); } };
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
  // The new voices: FM bells, marimba, plucks and bubbles through a short room (a generated reverb), so they don't
  // sound like bare oscillators. k scales them to the volume the old tones had at the same setting.
  let room = null;
  const out = () => {
    ac = ac || new AudioContext();
    if (!room) {
      const len = ac.sampleRate * 1.6, buf = ac.createBuffer(2, len, ac.sampleRate);
      for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3; }
      const rev = ac.createConvolver(), wet = ac.createGain();
      rev.buffer = buf; wet.gain.value = 0.22;
      rev.connect(wet).connect(ac.destination);
      room = rev;
    }
    return ac;
  };
  const env = (g, t, a, peak, dur) => { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); };
  const send = (node) => { node.connect(ac.destination); node.connect(room); };
  const fm = (k, f, t, { ratio = 1, index = 2, dur = 1.2, vol = 0.3, idxDecay = 0.4 } = {}) => {
    const c = ac.createOscillator(), m = ac.createOscillator(), mg = ac.createGain(), g = ac.createGain();
    c.frequency.value = f; m.frequency.value = f * ratio;
    mg.gain.setValueAtTime(f * index, t); mg.gain.exponentialRampToValueAtTime(f * 0.01, t + idxDecay);
    m.connect(mg).connect(c.frequency); env(g, t, 0.005, vol * k, dur); c.connect(g); send(g);
    c.start(t); m.start(t); c.stop(t + dur + 0.1); m.stop(t + dur + 0.1);
  };
  const mar = (k, f, t, { dur = 0.6, vol = 0.35 } = {}) => {
    const o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain(), g2 = ac.createGain(), lp = ac.createBiquadFilter();
    o.frequency.value = f; o2.frequency.value = f * 4; lp.type = 'lowpass'; lp.frequency.value = f * 6;
    env(g, t, 0.004, vol * k, dur); env(g2, t, 0.002, vol * k * 0.25, 0.08);
    o.connect(g); o2.connect(g2); g.connect(lp); g2.connect(lp); send(lp);
    o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + 0.2);
  };
  const pluck = (k, f, t, { dur = 0.5, vol = 0.35 } = {}) => {
    const o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
    o.type = 'triangle'; o.frequency.value = f; lp.type = 'lowpass';
    lp.frequency.setValueAtTime(f * 8, t); lp.frequency.exponentialRampToValueAtTime(f * 1.2, t + dur * 0.6);
    env(g, t, 0.003, vol * k, dur); o.connect(lp).connect(g); send(g); o.start(t); o.stop(t + dur + 0.1);
  };
  const bubble = (k, t, { from = 380, to = 900, dur = 0.18, vol = 0.35 } = {}) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + dur);
    env(g, t, 0.004, vol * k, dur + 0.05); o.connect(g); send(g); o.start(t); o.stop(t + dur + 0.1);
  };
  // (v) => play at volume v: the voice gets the context, its loudness k and the start time.
  const voice = (f) => (v) => { out(); f(v / 0.3 * 0.8, ac.currentTime + 0.03); };
  FC.SOUNDS = {
    kalimba: { name: 'Калімба', play: (v) => tone([1319, 1760], 'sine', 0.11, 1.1, v) },
    bell: { name: 'Дзвіночок', play: (v) => tone([988, 1319, 1760], 'sine', 0.1, 1.4, v) },
    marimba: { name: 'Маримба', play: voice((k, t) => mar(k, 880, t)) },
    bubble: { name: 'Бульбашка', play: voice((k, t) => bubble(k, t)) },
    pluck: { name: 'Тихий плак', play: voice((k, t) => pluck(k, 659, t, { dur: 0.35, vol: 0.3 })) },
    glass: { name: 'Скло', play: voice((k, t) => fm(k, 1568, t, { ratio: 3.5, index: 1.2, dur: 0.7, vol: 0.12, idxDecay: 0.15 })) },
    twoup: { name: 'Два тони вгору', play: voice((k, t) => { mar(k, 784, t); mar(k, 1175, t + 0.11); }) },
    chord: { name: 'Теплий акорд', play: voice((k, t) => [523, 659, 784].forEach((f, i) => fm(k, f, t + i * 0.05, { ratio: 1, index: 0.8, dur: 1.3, vol: 0.12, idxDecay: 0.6 }))) },
    glassbell: { name: 'Дзвоник-скло', play: voice((k, t) => { fm(k, 1319, t, { ratio: 3.5, index: 1.6, dur: 1.2, vol: 0.14 }); fm(k, 1976, t + 0.12, { ratio: 3.5, index: 1.4, dur: 1.2, vol: 0.1 }); }) },
    ping: { name: 'Пінг', play: voice((k, t) => fm(k, 1760, t, { ratio: 2, index: 1, dur: 0.9, vol: 0.16, idxDecay: 0.2 })) },
    dclick: { name: 'Подвійний клік', play: voice((k, t) => { pluck(k, 988, t, { dur: 0.18 }); pluck(k, 1319, t + 0.09, { dur: 0.25 }); }) },
    dropup: { name: 'Крапля вгору', play: voice((k, t) => { bubble(k, t, { from: 600, to: 1500, dur: 0.14, vol: 0.3 }); mar(k, 1568, t + 0.12, { dur: 0.5, vol: 0.22 }); }) },
    arp: { name: 'Маримба-арпеджіо', play: voice((k, t) => [523, 659, 784, 1047].forEach((f, i) => mar(k, f, t + i * 0.09, { dur: 0.8 }))) },
    festive: { name: 'Святковий акорд', play: voice((k, t) => { [392, 494, 587, 784].forEach((f, i) => fm(k, f, t + i * 0.07, { ratio: 1, index: 1, dur: 1.6, vol: 0.11, idxDecay: 0.8 })); fm(k, 1568, t + 0.32, { ratio: 3.5, index: 1.5, dur: 1.4, vol: 0.1 }); }) },
    cascade: { name: 'Скляний каскад', play: voice((k, t) => [1319, 1568, 1976, 2637].forEach((f, i) => fm(k, f, t + i * 0.08, { ratio: 3.5, index: 1.3, dur: 1.1, vol: 0.09 }))) },
  };
  // The first load ran before the sound list existed: once more, so sounds that are gone fall back.
  FC.s = FC.load();
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
