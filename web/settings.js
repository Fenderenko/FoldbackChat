// Settings page: pages grouped in the left menu (chat / look / app), one page at a time. Every change is saved at
// once (page storage + the host's file); the overlay picks it up through the storage event. Texts go through FC.t
// (the keys are Ukrainian).
(async () => {
  await FC.ready;
  const t = FC.t;
  const main = document.getElementById('main'), nav = document.getElementById('nav');
  let s = FC.load();
  // Rows that depend on another setting: greyed out with a note (`when`) or hidden (`showIf`); kept current on every change.
  const deps = [];
  const set = (k, v) => { s[k] = v; FC.save(s); syncDeps(); if (k.startsWith('ui')) theme(); };
  // Window theme, at once; the host colours the title bar to match. win — the Windows accent and mode from /state.
  let win = {}, caption = '';
  function theme() {
    FC.s = s;
    drawThemes();
    const c = FC.applyTheme(win);
    const v = `${c.bg.slice(1)},${c.fg.slice(1)},${c.light ? 1 : 0}`;
    if (v !== caption) { caption = v; FC.host('caption', v); }
    for (const b of document.querySelectorAll('.themes button')) b.classList.toggle('on', b.dataset.k === (s.uiTheme || 'hole'));
  }
  // Reload only once the settings file has the last change, or the page would read the older file back.
  const reload = () => FC.flush().then(() => location.reload());
  const syncDeps = () => deps.forEach(([r, cond, note, hide]) => {
    const on = !!cond();
    if (hide) { r.hidden = !on; return; }
    r.classList.toggle('off', !on);
    let n = r.querySelector('.offnote');
    if (!on && note) { if (!n) { n = el('<em class="offnote"></em>'); r.querySelector('label').appendChild(n); } n.textContent = t(note); } else n?.remove();
  });
  const when = (r, cond, note) => { deps.push([r, cond, note, false]); return r; };
  const showIf = (r, cond) => { deps.push([r, cond, '', true]); return r; };
  // Keys of the controls on the page being built, for its "reset" button.
  let pageKeys = [];
  const uses = (...k) => pageKeys.push(...k);
  const el = (html) => { const tp = document.createElement('template'); tp.innerHTML = html.trim(); return tp.content.firstChild; };
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  document.documentElement.lang = FC.lang();
  document.title = t('Foldback Chat — налаштування');

  // Controls -------------------------------------------------------------
  const row = (label, hint, ctl) => { const r = el(`<div class="row"><label>${esc(t(label))}${hint ? `<small>${esc(t(hint))}</small>` : ''}</label><div class="ctl"></div></div>`); r.querySelector('.ctl').append(...[].concat(ctl)); return r; };
  const text = (k, ph = '') => { uses(k); const i = el(`<input type="text" value="${esc(s[k])}" placeholder="${esc(ph)}">`); i.onchange = () => set(k, i.value.trim()); return i; };
  const area = (k) => { uses(k); const i = el(`<textarea>${esc(s[k])}</textarea>`); i.onchange = () => set(k, i.value); return i; };
  const check = (k) => { uses(k); const i = el('<input type="checkbox">'); i.checked = !!s[k]; i.onchange = () => set(k, i.checked); return i; };
  const labelled = (ctl, label) => { const l = el('<label class="chk"></label>'); l.append(ctl, label); return l; };
  const color = (k) => { uses(k); const i = el(`<input type="color" value="${esc(s[k])}">`); i.oninput = () => set(k, i.value); return i; };
  const select = (k, opts) => { uses(k); const i = el(`<select>${opts.map(([v, txt]) => `<option value="${esc(v)}" ${String(s[k]) === String(v) ? 'selected' : ''}>${esc(t(txt))}</option>`).join('')}</select>`); i.onchange = () => set(k, isNaN(+i.value) || i.value === '' ? i.value : +i.value); return i; };
  const range = (k, min, max, step, fmt = (v) => v) => {
    uses(k);
    const i = el(`<input type="range" min="${min}" max="${max}" step="${step}" value="${s[k]}">`), v = el(`<span class="val">${fmt(s[k])}</span>`);
    i.oninput = () => { set(k, +i.value); v.textContent = fmt(+i.value); };
    return [i, v];
  };
  const button = (txt, f, cls = '') => { const b = el(`<button class="${cls}">${esc(t(txt))}</button>`); b.onclick = f; return b; };
  const pct = (v) => Math.round(v * 100) + '%';
  const px = (v) => v + ' px';
  const sec = (v) => t('{n} с', { n: v });
  const fonts = Object.entries(FC.FONTS).map(([k, v]) => [k, v[1]]);
  const weights = [[300, 'Тонка'], [400, 'Звичайна'], [500, 'Середня'], [600, 'Напівжирна'], [700, 'Жирна']];

  // Menu icons: 24-unit outline glyphs, drawn with the text colour.
  const ICONS = {
    channels: '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5"/>',
    messages: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    highlights: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16v5M16.5 18.5h5"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
    sounds: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
    display: '<rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/>',
    colors: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
    fonts: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
    background: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    header: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
    window: '<path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>',
    keys: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    general: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    obs: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
    test: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3"/>',
  };
  const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[k] || ''}</svg>`;

  const pages = [];
  const group = (title) => nav.appendChild(el(`<div class="grp">${esc(t(title))}</div>`));
  const page = (id, title, rows, onReset) => {
    const sec_ = el(`<section id="${id}"><h2><span>${esc(t(title))}</span></h2></section>`);
    const keys = pageKeys;
    pageKeys = [];
    if (keys.length || onReset) {
      const b = button('Скинути', () => {
        if (!confirm(t('Скинути «{p}» до типових?', { p: t(title) }))) return;
        for (const k of keys) s[k] = structuredClone(FC.DEF[k]);
        FC.save(s);
        Promise.resolve(onReset && onReset()).then(reload);
      }, 'reset');
      sec_.querySelector('h2').appendChild(b);
    }
    rows.forEach((r) => sec_.appendChild(r));
    main.appendChild(sec_);
    const a = el(`<a href="#${id}">${icon(id)}<span>${esc(t(title))}</span></a>`);
    a.onclick = (e) => { e.preventDefault(); show(id); };
    nav.appendChild(a);
    pages.push([id, sec_, a]);
  };
  const show = (id) => {
    for (const [pid, sec_, a] of pages) { sec_.hidden = pid !== id; a.classList.toggle('on', pid === id); }
    try { localStorage.setItem('fc.page', id); } catch { /* storage unavailable */ }
    scrollTo(0, 0);
  };

  // ===== Chat ===========================================================
  group('Чат');

  const twSt = el('<span class="pill"><i></i><span></span></span>'), ytSt = el('<span class="pill"><i></i><span></span></span>');
  page('channels', 'Канали', [
    row('Twitch', 'нік каналу; чат читається як гість, без пароля', [check('twitchOn'), text('twitch', t('нік')), twSt]),
    row('YouTube', '@нік каналу, посилання на трансляцію або ID відео; ефір шукається сам раз на хвилину', [check('ytOn'), text('youtube', '@channel'), ytSt]),
    row('Емоути', 'емоути каналу й загальні з цих сервісів', [labelled(check('e7tv'), '7TV'), labelled(check('eBttv'), 'BTTV'), labelled(check('eFfz'), 'FFZ')]),
    row('Передавати YouTube у сцени OBS', 'сцени показуватимуть і YouTube-чат, поки програма відкрита', check('relay')),
  ]);
  setInterval(() => {
    for (const [p, k] of [[twSt, 'tw'], [ytSt, 'yt']]) {
      const v = (localStorage.getItem('fc.status.' + k) || 'off').split('|');
      p.className = 'pill ' + v[0];
      p.lastChild.textContent = FC.statusText(v[0], v[1]);
    }
  }, 1000);

  page('messages', 'Повідомлення', [
    row('Скільки показувати', '', range('maxMsgs', 3, 40, 1)),
    row('Зникати через', '0 — не зникають', range('fade', 0, 120, 5, (v) => (v ? sec(v) : t('ніколи')))),
    row('Ховати чат, коли тихо', 'весь чат з’являється з новим повідомленням і ховається, якщо стільки секунд нових немає; 0 — видно завжди', range('idleHide', 0, 300, 5, (v) => (v ? sec(v) : t('ніколи')))),
    row('Нові зверху', 'інакше нові з’являються знизу', check('newestTop')),
    row('Відповіді', 'над відповіддю — кому відповідають і на що', check('showReplies')),
    row('Ховати ботів', 'список нижче', check('hideBots')),
    when(row('Боти', 'через кому', area('bots')), () => s.hideBots, 'діє, коли ввімкнено «Ховати ботів»'),
    row('Ховати команди', 'повідомлення, що починаються з «!»', check('hideCommands')),
    row('Ховати посилання', '', check('hideLinks')),
    row('Ігнорувати людей', 'ніки через кому — їх не буде видно й чутно', area('ignore')),
  ]);

  page('highlights', 'Підсвічування', [
    row('Згадки', 'слова через кому: твій нік, ім’я — повідомлення з ними світяться й мають свій звук; порожньо — нік каналу Twitch', area('mentions')),
    row('Свої слова', 'через кому: будь-які слова, які не хочеш пропустити, — світяться й звучать, як згадки', area('hlWords')),
    row('Новачки', 'перше повідомлення людини на каналі', check('hlFirst')),
    row('Модератори', '', check('hlMods')),
    row('Події', 'підписки, рейди, біти, суперчати', check('hlEvents')),
    row('Бали каналу', '«виділене повідомлення» — тло кольору ніку; нагорода з текстом — значок біля ніку', check('hlPoints')),
    row('Як підсвічувати', 'рамка, смужка й тло — всередині рядка, не обрізаються краєм вікна', select('hlStyle', [['ring', 'Рамка'], ['glow', 'Світіння'], ['bar', 'Смужка зліва'], ['tint', 'Тло']])),
  ]);

  const plist = el('<div class="plist"></div>');
  const savePeople = () => set('people', s.people);
  const drawPeople = () => {
    s.people = Array.isArray(s.people) ? s.people : [];
    const rows = s.people.map((p, i) => {
      const r = el(`<div class="prow"><input type="text" placeholder="${esc(t('нік'))}" value="${esc(p.login)}"><input type="checkbox" title="${esc(t('свій колір'))}" ${p.color ? 'checked' : ''}><input type="color" value="${esc(p.color || '#3cc6dc')}"><input type="text" placeholder="${esc(t('позначка'))}" maxlength="16" value="${esc(p.mark)}"></div>`);
      const [login, useColor, col, mark] = r.querySelectorAll('input');
      login.onchange = () => { p.login = login.value.trim().replace(/^@/, ''); savePeople(); };
      useColor.onchange = () => { p.color = useColor.checked ? col.value : ''; savePeople(); };
      col.oninput = () => { useColor.checked = true; p.color = col.value; savePeople(); };
      mark.onchange = () => { p.mark = mark.value.trim(); savePeople(); };
      r.appendChild(button('✕', () => { s.people.splice(i, 1); savePeople(); drawPeople(); }, 'danger'));
      return r;
    });
    plist.replaceChildren(...rows, button('Додати', () => { s.people.push({ login: '', color: '', mark: '' }); savePeople(); drawPeople(); plist.querySelector('.prow:last-of-type input')?.focus(); }));
  };
  drawPeople();
  uses('people');
  page('people', 'Глядачі', [
    row('Свої кольори й позначки', 'нік — як у чаті Twitch або ім’я на YouTube; галочка — свій колір ніку; позначка — коротке слово біля ніку', plist),
  ]);

  const sndRow = (ev, label, hint) => {
    const sel = el(`<select>${[['off', 'Без звуку'], ...Object.entries(FC.SOUNDS).map(([k, v]) => [k, v.name]), ['custom', 'Свій файл…']].map(([v, txt]) => `<option value="${v}" ${s.snd[ev] === v ? 'selected' : ''}>${esc(t(txt))}</option>`).join('')}</select>`);
    const file = el('<input type="file" accept="audio/*" style="display:none">');
    const vol = el(`<input type="range" min="0" max="1" step="0.05" value="${s.vol[ev]}" style="width:140px">`);
    const has = el(`<span class="val">${localStorage.getItem('fc.snd.' + ev) ? esc(t('файл є')) : ''}</span>`);
    sel.onchange = () => { if (sel.value === 'custom') file.click(); s.snd[ev] = sel.value; FC.save(s); };
    file.onchange = () => {
      const f = file.files[0];
      if (!f) return;
      if (f.size > 1.5e6) { alert(t('Файл завеликий: до 1,5 МБ.')); return; }
      const r = new FileReader();
      r.onload = () => { try { localStorage.setItem('fc.snd.' + ev, r.result); FC.store('snd.' + ev, r.result); has.textContent = t('файл є'); s.snd[ev] = 'custom'; FC.save(s); } catch { alert(t('Не вдалося зберегти файл.')); } };
      r.readAsDataURL(f);
    };
    vol.oninput = () => { s.vol[ev] = +vol.value; FC.save(s); };
    return row(label, hint, [sel, vol, button('▶', () => { FC.s = s; FC.play(ev); }), has, file]);
  };
  uses('snd', 'vol');
  page('sounds', 'Звуки', [
    row('Загальна гучність', 'звуки чує лише той, хто сидить за ПК: у стрім вони не йдуть', range('volume', 0, 1, 0.05, pct)),
    sndRow('msg', 'Нове повідомлення', ''),
    sndRow('first', 'Новачок у чаті', ''),
    sndRow('mention', 'Згадка', ''),
    sndRow('event', 'Події', 'підписки, рейди, біти, суперчати'),
    row('Пауза між звуками', 'для звичайних повідомлень', range('cooldown', 0, 20, 1, sec)),
    row('Без звуку на свої повідомлення', '', check('quietOwn')),
  ]);

  // ===== Look ===========================================================
  group('Вигляд');

  page('display', 'Відображення', [
    row('Вигляд повідомлень', '', select('style', [['cards', 'Картки'], ['lines', 'Компактні рядки']])),
    when(row('Велика літера ніку', 'кольоровий блок зліва', check('letter')), () => s.style !== 'lines', 'лише для карток'),
    row('Розмір тексту', '', range('font', 12, 30, 1, px)),
    row('Розмір емоутів', '', range('emoteSize', 1, 3, 0.1, (v) => v.toFixed(1) + '×')),
    row('Значок платформи', 'Twitch / YouTube біля ніку', check('showPlatform')),
    row('Значки ролей', 'стрімер, мод, VIP, спонсор, «вперше»', check('showBadges')),
    row('Час повідомлення', '', check('showTime')),
  ]);

  // Palette: one colour per viewer, picked by a hash of the name, so a person keeps theirs.
  const palBox = el('<div class="pal"></div>');
  const drawPal = () => {
    if (!Array.isArray(s.palette) || !s.palette.length) s.palette = FC.DEF.palette.slice();
    const pal = s.palette;
    const chips = pal.map((c, i) => {
      const w = el(`<span class="chip"><input type="color" value="${esc(c)}"><button class="x" title="${esc(t('Прибрати'))}">✕</button></span>`);
      w.querySelector('input').oninput = (e) => { pal[i] = e.target.value; set('palette', pal); };
      w.querySelector('button').onclick = () => { if (pal.length > 1) { pal.splice(i, 1); set('palette', pal); drawPal(); } };
      return w;
    });
    palBox.replaceChildren(...chips, button('+', () => { pal.push(FC.genPalette(1)[0]); set('palette', pal); drawPal(); }, 'add'));
  };
  drawPal();
  const presets = el(`<select><option value="">${esc(t('Обрати…'))}</option>${Object.entries(FC.PALETTES).map(([k, [n, c]]) => `<option value="${k}">${esc(t(n))} · ${c.length}</option>`).join('')}</select>`);
  presets.onchange = () => { const p = FC.PALETTES[presets.value]; if (p) { set('palette', p[1].slice()); drawPal(); } presets.value = ''; };
  uses('palette');
  const palOn = () => s.nameMode !== 'mono', palNote = 'не діє в режимі «Один колір»';
  page('colors', 'Кольори', [
    row('Кольори ніків', 'як у Twitch — колір, який людина обрала собі в Twitch; хто не обрав, і YouTube — з палітри', select('nameMode', [['brand', 'Палітра'], ['twitch', 'Як у Twitch'], ['mono', 'Один колір (акцент)']])),
    when(row('Палітра', 'кожна людина отримує один колір із палітри й зберігає його; клацни колір, щоб змінити', palBox), palOn, palNote),
    when(row('Готові палітри', '', presets), palOn, palNote),
    when(row('Згенерувати палітру', 'кольори однакової яскравості, що пасують одне одному й читаються на темному', [...range('palGen', 2, 12, 1, (v) => t('{n} кол.', { n: v })), button('Згенерувати', () => { set('palette', FC.genPalette(s.palGen)); drawPal(); })]), palOn, palNote),
    row('Колір акценту', 'згадки, «наживо», рамки', color('accent')),
    row('Колір тексту', '', color('text')),
  ]);

  // Own font: any font installed in Windows (the list comes from the host; typing a name works too).
  const sysFonts = el('<datalist id="sysfonts"></datalist>');
  fetch('/fonts').then((r) => r.json()).then((l) => sysFonts.replaceChildren(...l.map((f) => { const o = document.createElement('option'); o.value = f; return o; }))).catch(() => {});
  const ownFont = (k) => { const i = text(k, t('назва шрифту з Windows')); i.setAttribute('list', 'sysfonts'); return i; };
  const weightNote = el(`<div class="note">${esc(t('Свій шрифт: товщина спрацює, лише якщо в шрифті є таке накреслення. Якщо немає — Windows візьме найближче, і дві товщини можуть виглядати однаково.'))}</div>`);
  page('fonts', 'Шрифти', [
    sysFonts,
    row('Шрифт ніків', '', select('fontName', fonts)),
    showIf(row('Свій шрифт ніків', '', ownFont('fontNameOwn')), () => s.fontName === 'own'),
    row('Товщина ніків', '', select('nameWeight', weights)),
    row('Ніки великими літерами', '', check('nameUpper')),
    row('Шрифт повідомлень', '', select('fontText', fonts)),
    showIf(row('Свій шрифт повідомлень', '', ownFont('fontTextOwn')), () => s.fontText === 'own'),
    row('Товщина повідомлень', '', select('textWeight', weights)),
    showIf(weightNote, () => s.fontName === 'own' || s.fontText === 'own'),
    row('Обведення тексту', 'тінь навколо літер — читається на будь-якій грі, особливо з прозорими рядками', range('outline', 0, 1, 0.05, pct)),
  ]);

  page('background', 'Фон', [
    row('Колір рядків', '', color('cardColor')),
    row('Прозорість рядків', '100% — рядки повністю прозорі, видно лише текст', range('cardT', 0, 1, 0.02, pct)),
    row('Колір підкладки вікна', 'фон усього вікна за рядками', color('panelColor')),
    row('Прозорість підкладки', '100% — вікна не видно зовсім', range('panelT', 0, 1, 0.02, pct)),
    row('Заокруглення рядків', '', range('cardRadius', 0, 18, 1, px)),
    row('Відстань між рядками', '', range('gap', 0, 20, 1, px)),
  ]);

  const hdrOn = () => s.showHeader, hdrNote = 'верхній рядок вимкнено';
  page('header', 'Верхній рядок', [
    row('Показувати верхній рядок', '', check('showHeader')),
    when(row('Що показувати', '', [labelled(check('hdrTw'), t('Стан Twitch')), labelled(check('hdrYt'), t('Стан YouTube')), labelled(check('hdrViewers'), t('Глядачі')), labelled(check('hdrUptime'), t('Скільки йде стрім')), labelled(check('hdrClock'), t('Годинник'))]), hdrOn, hdrNote),
    when(row('Розмір тексту', '', range('hdrSize', 10, 22, 1, px)), hdrOn, hdrNote),
    when(row('Колір тексту', '', color('hdrColor')), hdrOn, hdrNote),
    when(row('Прозорість підкладки', 'темна смуга під рядком; 100% — без неї', range('hdrT', 0, 1, 0.05, pct)), hdrOn, hdrNote),
  ]);

  // ===== App ============================================================
  group('Програма');

  const lockBtn = button('', () => FC.host('lock').then(refresh));
  const showBtn = button('', () => FC.host('show').then(refresh));
  const perGame = el('<input type="checkbox">');
  perGame.onchange = () => FC.host('pergame', perGame.checked ? 1 : 0).then(refresh);
  const games = el('<div class="ctl"></div>');
  let gamesKey = '', monKey = '';
  const monSel = el('<select></select>');
  monSel.onchange = () => FC.host('monitor', monSel.value).then(refresh);
  const monRow = row('Монітор', 'чат переїде на обраний монітор, на те саме місце', monSel);
  page('window', 'Вікно', [
    row('Закріпити чат', 'закріплений чат пропускає клацання в гру; щоб посунути, змінити розмір чи прогорнути історію коліщатком — відкріпи', lockBtn),
    row('Показ чату', '', showBtn),
    row('Окреме місце для кожної гри', 'у грі на весь екран відкріпи й посунь чат — наступного разу в цій грі він стане туди сам; поза іграми — звичайне місце', perGame),
    row('Запам’ятані ігри', '', games),
    monRow,
    row('Повернути вікно чату на місце', 'якщо воно загубилося за екраном', button('Повернути', () => FC.host('resetpos'))),
    row('Гра має бути у вікні без рамок', 'у повноекранному режимі гра перекриває будь-які вікна', el('<span class="lab">borderless</span>')),
  ]);

  // The chat for OBS: browser sources (/obs, /obs?featured — they read the settings file and follow its changes),
  // the dock (/dock) and the local API for other apps.
  const base = `127.0.0.1:${location.port || 8792}`;
  const address = (url) => {
    const box = el(`<input type="text" class="url" readonly value="${esc(url)}">`);
    box.onclick = () => box.select();
    const copied = el('<span class="val"></span>');
    const copy = button('Копіювати', async () => {
      try { await navigator.clipboard.writeText(url); } catch { box.select(); document.execCommand('copy'); }
      copied.textContent = t('скопійовано');
      setTimeout(() => { copied.textContent = ''; }, 2000);
    });
    return [box, copy, copied];
  };
  page('obs', 'OBS', [
    row('Чат як джерело OBS', 'в OBS: Джерела → + → Браузер, встав цю адресу; ширина й висота — на свій смак, наприклад 420 × 620', address(`http://${base}/obs`)),
    el(`<div class="note">${esc(t('Джерело показує той самий чат: канали, вигляд і зміни налаштувань підхоплює одразу. Звуків і підказок у ньому немає, а програма має бути відкрита. Чат поверх гри працює як і раніше: можна лишити обидва або сховати вікно.'))}</div>`),
    row('Док для OBS', 'в OBS: Docks → Custom Browser Docks, встав цю адресу; там уся історія чату, а клац по повідомленню виводить його на стрім', address(`http://${base}/dock`)),
    row('Обране повідомлення', 'окреме джерело «Браузер» для повідомлення, обраного в доці: картка як у чаті, лише більша; наприклад 800 × 300', address(`http://${base}/obs?featured`)),
    row('Скільки показувати обране', '0 — доки не прибереш у доці', range('featSec', 0, 60, 1, (v) => (v ? sec(v) : t('доки не прибереш')))),
    row('Розмір обраного', 'відносно розміру тексту чату', range('featScale', 1, 2.5, 0.1, (v) => v.toFixed(1) + '×')),
    row('API для інших програм', 'усі повідомлення й події як JSON: WebSocket або SSE (Streamer.bot, Stream Deck, свої скрипти)', [...address(`ws://${base}/api/ws`), button('Опис', () => FC.host('open', 'api'))]),
  ]);

  const hkBtns = [];
  const hkRow = (i, label) => {
    const b = el('<button class="hk"></button>');
    b.onclick = () => {
      b.classList.add('rec'); b.textContent = t('натисни поєднання…');
      const on = (e) => {
        e.preventDefault();
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
        removeEventListener('keydown', on, true);
        b.classList.remove('rec');
        if (e.key === 'Escape') { refresh(); return; }
        const k = /^F\d+$/.test(e.key) ? e.key : e.code.replace(/^Key|^Digit/, '');
        const combo = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Win', k].filter(Boolean).join('+');
        FC.host('hk', combo, '&id=' + i).then(refresh);
      };
      addEventListener('keydown', on, true);
    };
    const busy = el('<span class="warn"></span>');
    hkBtns[i] = [b, busy];
    return row(label, '', [b, button('✕', () => FC.host('hk', '-', '&id=' + i).then(refresh), 'clear'), busy]);
  };
  page('keys', 'Клавіші', [
    hkRow(0, 'Показати / сховати чат'),
    hkRow(1, 'Закріпити / відкріпити'),
    hkRow(2, 'Відкрити налаштування'),
    el(`<div class="note">${esc(t('Поєднання, яке вже має інша дія, міняється з нею місцями. ✕ — без клавіші.'))}</div>`),
  ], () => FC.host('hkreset'));

  const langSel = el(`<select>${FC.LANGS.map(([v, n]) => `<option value="${v}" ${s.lang === v ? 'selected' : ''}>${esc(v === 'auto' ? t(n) : n)}</option>`).join('')}</select>`);
  langSel.onchange = () => { set('lang', langSel.value); FC.s = s; FC.host('lang', FC.lang()).then(reload); };
  const autostart = el('<input type="checkbox">');
  autostart.onchange = () => FC.host('autostart', autostart.checked ? 1 : 0).then(refresh);
  const obsOnly = el('<input type="checkbox">');
  obsOnly.onchange = () => FC.host('obsonly', obsOnly.checked ? 1 : 0).then(refresh);
  const exit = el('<div class="actions"></div>');
  exit.append(
    button('Скинути все', () => {
      if (!confirm(t('Скинути всі налаштування до типових? Канали, кольори, звуки й клавіші стануть як після встановлення.'))) return;
      FC.save({});
      FC.host('hkreset').then(reload);
    }),
    button('Вийти', () => FC.host('quit'), 'danger'),
  );
  // Window theme: a chip per theme (its background with the accent), own colours for «custom».
  const themeBox = el('<div class="themes"></div>');
  const drawThemes = () => themeBox.replaceChildren(...Object.entries(FC.THEMES).map(([k, [name]]) => {
    const c = FC.themeColors(k, k === 'win' ? { ...win, light: false } : win);
    const b = el(`<button data-k="${k}"><span class="sw"><i></i></span>${esc(t(name))}</button>`);
    // «Same as Windows» shows both of its modes: light and dark halves.
    b.querySelector('.sw').style.background = k === 'win' ? 'linear-gradient(135deg, #f3f3f3 50%, #202020 50%)' : c.bg;
    b.querySelector('.sw i').style.background = c.hi;
    b.onclick = () => set('uiTheme', k);
    return b;
  }));
  uses('uiTheme', 'uiBg', 'uiAccent');
  page('general', 'Загальне', [
    row('Тема вікна', 'вікно налаштувань і док OBS; сам чат має свої кольори — у «Кольори» й «Фон»', themeBox),
    showIf(row('Тло вікна', '', color('uiBg')), () => s.uiTheme === 'custom'),
    showIf(row('Акцент', 'перемикачі, повзунки, обране', color('uiAccent')), () => s.uiTheme === 'custom'),
    row('Мова', '', langSel),
    row('Запускати з Windows', '', autostart),
    row('Разом з OBS', 'чат з’являється, коли відкривається OBS, і ховається, коли OBS закрито; вмикає й запуск з Windows', obsOnly),
    exit,
  ]);

  const version = el('<span class="val"></span>');
  const updState = el('<span class="upd"></span>');
  const checkUpdate = async () => {
    updState.textContent = t('Перевіряю…');
    let r = {};
    try { r = await fetch('/update').then((x) => x.json()); } catch { /* host unavailable */ }
    updState.replaceChildren(t({ new: 'Є нова версія {v}', latest: 'У тебе найновіша версія', none: 'Релізів на GitHub ще немає' }[r.status] || 'Не вдалося перевірити: немає зв’язку', { v: r.latest || '' }));
    if (r.status === 'new') updState.appendChild(button('Завантажити', () => FC.host('open', 'releases')));
  };
  const head = el(`<div class="about"><img src="icon.png" alt=""><div><b>Foldback Chat</b></div></div>`);
  head.querySelector('div').appendChild(version);
  page('about', 'Про програму', [
    head,
    row('Автор', '', el('<span>Fenderenko</span>')),
    row('GitHub', 'github.com/Fenderenko/FoldbackChat', button('Відкрити', () => FC.host('open', 'repo'))),
    row('Оновлення', '', [button('Перевірити', checkUpdate), updState]),
  ]);

  // The overlay window hears the storage event, the OBS source the host's /events.
  const test = (m) => {
    const v = JSON.stringify({ ...m, n: Date.now() });
    localStorage.setItem('fc.test', v);
    fetch('/push?e=test', { method: 'POST', body: v }).catch(() => {});
  };
  page('test', 'Перевірка', [
    row('Тестові повідомлення', 'з’являться в чаті поверх гри й у джерелі OBS; ніки мають і кольори Twitch — видно різницю між режимами кольорів', [
      button('Повідомлення', () => test({ name: 'Lyalka', color: '#FF69B4', text: t('привіт! як полювання?') })),
      button('Новачок', () => test({ name: 'Novachok', color: '#1E90FF', text: t('я тут уперше'), first: true })),
      button('Згадка', () => test({ name: 'Kozak_77', color: '#9ACD32', text: t('{name}, глянь чат', { name: (s.mentions.split(',')[0] || s.twitch || 'Foldback').trim() }) })),
      button('YouTube', () => test({ platform: 'yt', name: 'dzyga', text: t('дивлюсь з ютуба') })),
      button('Підписка', () => test({ kind: 'sub', name: 'huntress_ua', color: '#DAA520', text: t('тримай!'), amount: t('підписка · {n} міс.', { n: 7 }) })),
      button('Суперчат', () => test({ platform: 'yt', kind: 'superchat', name: 'Vovk', text: t('на патрони'), amount: '100 ₴' })),
      button('Відповідь', () => test({ name: 'Orest', color: '#FF4500', text: t('згоден, гарний був постріл'), reply: { name: 'Lyalka', text: t('привіт! як полювання?') } })),
      button('Бали каналу', () => test({ name: 'Myroslava', color: '#8A2BE2', text: t('виділене за бали'), highlighted: true })),
      button('Нагорода', () => test({ name: 'Kozak_77', color: '#9ACD32', text: t('зіграй на снайперці'), reward: true })),
    ]),
  ]);

  syncDeps();
  theme();
  let first = 'channels';
  try { first = localStorage.getItem('fc.page') || first; } catch { /* storage unavailable */ }
  show(pages.some(([id]) => id === first) ? first : 'channels');

  async function refresh() {
    const st = await FC.state();
    const w = { accent: st.accent, light: !!st.light };
    if (JSON.stringify(w) !== JSON.stringify(win)) { win = w; theme(); }
    lockBtn.textContent = t(st.locked ? 'Закріплено — відкріпити' : 'Відкріплено — закріпити');
    showBtn.textContent = t(st.shown ? 'Видно — сховати' : 'Сховано — показати');
    autostart.checked = !!st.autostart;
    obsOnly.checked = !!st.obsonly;
    version.textContent = st.version ? t('версія {v}', { v: st.version }) : '';
    (st.hk || []).forEach((v, i) => {
      if (!hkBtns[i] || hkBtns[i][0].classList.contains('rec')) return;
      hkBtns[i][0].textContent = !v || v === '-' ? t('немає') : v;
      hkBtns[i][1].textContent = st.hkbusy?.[i] ? t('зайнято іншою програмою — обери інше') : '';
    });
    perGame.checked = !!st.pergame;
    const mk = JSON.stringify([st.monitors, st.monitor]);
    if (mk !== monKey) {
      monKey = mk;
      const mons = st.monitors || [];
      monRow.hidden = mons.length < 2;
      monSel.replaceChildren(...mons.map((m, i) => {
        const o = document.createElement('option');
        o.value = i;
        o.textContent = t('Монітор {n}', { n: i + 1 }) + ` · ${m.w}×${m.h}` + (m.primary ? ' · ' + t('основний') : '');
        o.selected = i === st.monitor;
        return o;
      }));
    }
    const key = JSON.stringify([st.games, st.game]);
    if (key !== gamesKey) {
      gamesKey = key;
      const items = (st.games || []).map((g) => { const x = el(`<span class="game">${esc(g)}${g === st.game ? ' · ' + esc(t('зараз')) : ''}</span>`); x.appendChild(button('Забути', () => FC.host('forget', g).then(refresh))); return x; });
      games.replaceChildren(...(items.length ? items : [el(`<span class="val">${esc(t('ще жодної'))}</span>`)]));
    }
  }
  refresh();
  setInterval(refresh, 3000);
})();
