// Tray menu (/menu): a card in the window theme that the host shows by the tray icon. The host calls fcMenu() each
// time before it shows the card; the page draws the current state and tells the host its height (menusize).
// Toggles keep the card open, the other actions close it (menuhide); so do Esc and a click away (host side).
(async () => {
  const t = FC.t, card = document.getElementById('card');
  const ICON = {
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    reset: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    power: '<path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>',
  };
  const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const hide = () => FC.host('menuhide');
  await FC.ready;
  document.documentElement.lang = FC.lang();

  async function draw() {
    const st = await FC.state();
    FC.applyTheme({ accent: st.accent, light: !!st.light });
    const sw = (k, on, ic, label) => `<button class="it" data-k="${k}">${icon(ic)}<span>${esc(t(label))}</span><span class="sw${on ? ' on' : ''}"></span></button>`;
    card.innerHTML = `
      <div class="hd"><img src="icon.png" alt=""><b>Foldback Chat</b><span class="v">${esc(st.version || '')}</span></div>
      <div class="sep"></div>
      ${sw('show', st.shown, 'eye', 'Показувати чат')}
      ${sw('lock', st.locked, 'lock', 'Закріпити')}
      <button class="it" data-k="settings">${icon('settings')}<span>${esc(t('Налаштування'))}</span></button>
      <button class="it" data-k="resetpos">${icon('reset')}<span>${esc(t('На місце'))}</span></button>
      <div class="sep"></div>
      <button class="it ex" data-k="quit">${icon('power')}<span>${esc(t('Вихід'))}</span></button>`;
    for (const b of card.querySelectorAll('button')) {
      b.onclick = async () => {
        const k = b.dataset.k;
        if (k === 'show' || k === 'lock') { await FC.host(k); draw(); return; }
        hide();
        FC.host(k);
      };
    }
    FC.host('menusize', Math.ceil(card.getBoundingClientRect().height));
  }
  window.fcMenu = draw;
  addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  // The tray card follows the theme and channels chosen in the settings.
  FC.onChange(draw);
  draw();
})();
