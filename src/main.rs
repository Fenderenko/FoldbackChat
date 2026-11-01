#![windows_subsystem = "windows"]
//! Foldback Chat: Twitch + YouTube chat in a transparent always-on-top window over the game, plus a
//! settings window. The overlay uses WebView2 visual hosting (DirectComposition) so its background is
//! truly transparent; "locked" makes the window click-through. OBS never sees it: the game capture
//! takes only the game. The pages talk to this host over the local HTTP server (net.rs).

mod net;

use std::{
    cell::RefCell,
    ffi::c_void,
    path::PathBuf,
    sync::atomic::{AtomicIsize, Ordering},
};

use webview2_com::{
    CoreWebView2EnvironmentOptions, CreateCoreWebView2CompositionControllerCompletedHandler, CreateCoreWebView2ControllerCompletedHandler, CreateCoreWebView2EnvironmentCompletedHandler,
    Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_COLOR, CreateCoreWebView2EnvironmentWithOptions, ICoreWebView2, ICoreWebView2Controller, ICoreWebView2Controller2, ICoreWebView2Environment, ICoreWebView2Environment3,
        ICoreWebView2EnvironmentOptions, ICoreWebView2ExecuteScriptCompletedHandler,
    },
};
use windows::{
    Win32::{
        Foundation::{CloseHandle, COLORREF, ERROR_ALREADY_EXISTS, ERROR_SUCCESS, GetLastError, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
        Graphics::{
            DirectComposition::{DCompositionCreateDevice2, IDCompositionDesktopDevice, IDCompositionTarget, IDCompositionVisual2},
            Dwm::{DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE, DwmSetWindowAttribute},
            Gdi::{BeginPaint, CreateSolidBrush, DeleteObject, EndPaint, FillRect, FrameRect, GetMonitorInfoW, HGDIOBJ, InvalidateRect, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow, PAINTSTRUCT},
        },
        System::{
            Com::{COINIT_APARTMENTTHREADED, CoInitializeEx},
            Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS},
            LibraryLoader::GetModuleHandleW,
            Registry::{HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_DWORD, RRF_RT_REG_SZ, RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW},
            Threading::{CreateMutexW, GetCurrentProcessId, OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW},
        },
        UI::{
            HiDpi::{DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, GetDpiForWindow, SetProcessDpiAwarenessContext},
            Input::KeyboardAndMouse::{HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, MOD_WIN, RegisterHotKey, UnregisterHotKey},
            Shell::{NIF_ICON, NIF_MESSAGE, NIF_TIP, NIM_ADD, NIM_DELETE, NIM_MODIFY, NOTIFY_ICON_MESSAGE, NOTIFYICONDATAW, ShellExecuteW, Shell_NotifyIconW},
            WindowsAndMessaging::*,
        },
    },
    core::{HSTRING, IUnknown, Interface, PCWSTR, PWSTR, w},
};

const WM_CMD: u32 = WM_APP + 1;
const WM_TRAY: u32 = WM_APP + 2;
/// Sent by a second copy: open the settings of the running one.
const WM_OPEN: u32 = WM_APP + 3;
const TIMER_TOP: usize = 1;
const RUN_KEY: PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
const HK_DEFAULT: [&str; 3] = ["Alt+Shift+C", "Alt+Shift+X", "Alt+Shift+S"];

static MAIN: AtomicIsize = AtomicIsize::new(0);

#[derive(Default)]
struct App {
    main: HWND,
    ov: HWND,
    set: HWND,
    env: Option<ICoreWebView2Environment>,
    ov_ctl: Option<ICoreWebView2Controller>,
    ov_wv: Option<ICoreWebView2>,
    dcomp: Option<(IDCompositionDesktopDevice, IDCompositionTarget, IDCompositionVisual2)>,
    set_ctl: Option<ICoreWebView2Controller>,
    set_creating: bool,
    set_pending: bool,
    locked: bool,
    shown: bool,
    /// Usual place of the chat; with `per_game`, a fullscreen game may have its own (`games`).
    base: RECT,
    per_game: bool,
    games: Vec<(String, RECT)>,
    /// Exe of the fullscreen foreground game ("" — none), checked every 2 s.
    game: String,
    /// Show the chat while OBS runs, hide it when OBS closes; `obs_seen` — OBS state at the last check.
    obs_only: bool,
    obs_seen: Option<bool>,
    /// Resizing by hand: the window keeps its size until the drag ends, an outline (`frame`) shows `size_to`.
    sizing: bool,
    size_to: RECT,
    frame: HWND,
    /// Language of the host's own texts ("uk", "en"), set by the pages.
    lang: String,
    hk: [String; 3],
    hk_busy: [bool; 3],
    taskbar_msg: u32,
    icon: HICON,
}

/// Host texts in the page language (keys are Ukrainian; a missing translation stays Ukrainian).
fn tr(uk: &'static str) -> &'static str {
    if app(|a| a.lang != "en") {
        return uk;
    }
    match uk {
        "Налаштування" => "Settings",
        "Показувати чат" => "Show chat",
        "Закріпити (клацання крізь чат)" => "Lock (clicks go through)",
        "Повернути вікно на місце" => "Reset window position",
        "Вихід" => "Exit",
        "Foldback Chat — налаштування" => "Foldback Chat — settings",
        "Порт 8792 зайнятий: Foldback Chat не може запуститися." => "Port 8792 is busy: Foldback Chat can't start.",
        "Не вдалося створити вікно чату (WebView2)." => "Couldn't create the chat window (WebView2).",
        "Потрібен Microsoft Edge WebView2 Runtime." => "Microsoft Edge WebView2 Runtime is required.",
        _ => uk,
    }
}

const REPO: &str = "https://github.com/Fenderenko/FoldbackChat";

thread_local! {
    static APP: RefCell<App> = RefCell::new(App::default());
}

fn app<R>(f: impl FnOnce(&mut App) -> R) -> R {
    APP.with(|a| f(&mut a.borrow_mut()))
}

const DIR: &str = "Foldback Chat";
/// Folder and autostart name before the rename.
const OLD: &str = "FndrChat";

fn env_dir(var: &str) -> PathBuf {
    PathBuf::from(std::env::var(var).unwrap_or_else(|_| ".".into()))
}

fn data_dir() -> PathBuf {
    let d = env_dir("APPDATA").join(DIR);
    let _ = std::fs::create_dir_all(&d);
    d
}

/// Also holds the pages' settings (localStorage of the WebView2 profile).
fn webview_dir() -> PathBuf {
    env_dir("LOCALAPPDATA").join(DIR).join("WebView2")
}

/// The app was called FndrChat: its folders (window places, keys, the WebView2 profile with the settings)
/// and autostart move to the new name once.
fn migrate_old_name() {
    for var in ["APPDATA", "LOCALAPPDATA"] {
        let (old, new) = (env_dir(var).join(OLD), env_dir(var).join(DIR));
        if old.is_dir() && !new.exists() {
            let _ = std::fs::rename(&old, &new);
        }
    }
    unsafe {
        if RegGetValueW(HKEY_CURRENT_USER, RUN_KEY, w!("FndrChat"), RRF_RT_REG_SZ, None, None, None) == ERROR_SUCCESS {
            let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, RUN_KEY, w!("FndrChat"));
            set_autostart(true);
        }
    }
}

fn main() {
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let _mutex = CreateMutexW(None, true, w!("Local\\FoldbackChatSingleton"));
        if GetLastError() == ERROR_ALREADY_EXISTS {
            if let Ok(h) = FindWindowW(w!("FoldbackChatMain"), PCWSTR::null()) {
                let _ = PostMessageW(Some(h), WM_OPEN, WPARAM(0), LPARAM(0));
            }
            return;
        }
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let inst = GetModuleHandleW(None).unwrap_or_default();
        let icon = LoadImageW(Some(inst.into()), PCWSTR(1 as *const u16), IMAGE_ICON, 0, 0, LR_DEFAULTSIZE).map(|h| HICON(h.0)).unwrap_or_default();
        let small = LoadImageW(Some(inst.into()), PCWSTR(1 as *const u16), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), LR_DEFAULTCOLOR)
            .map(|h| HICON(h.0))
            .unwrap_or(icon);
        let classes: [(PCWSTR, WNDPROC, Option<windows::Win32::Graphics::Gdi::HBRUSH>); 4] = [
            (w!("FoldbackChatMain"), Some(main_proc), None),
            (w!("FoldbackChatOverlay"), Some(overlay_proc), None),
            (w!("FoldbackChatSettings"), Some(settings_proc), Some(CreateSolidBrush(COLORREF(0x100f0f)))),
            (w!("FoldbackChatFrame"), Some(frame_proc), None),
        ];
        for (name, proc_, bg) in classes {
            let wc = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                lpfnWndProc: proc_,
                hInstance: inst.into(),
                hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(),
                hIcon: icon,
                hIconSm: small,
                hbrBackground: bg.unwrap_or_default(),
                lpszClassName: name,
                ..Default::default()
            };
            RegisterClassExW(&wc);
        }
        let Ok(main) = CreateWindowExW(WINDOW_EX_STYLE(0), w!("FoldbackChatMain"), w!("Foldback Chat"), WS_OVERLAPPED, 0, 0, 0, 0, None, None, Some(inst.into()), None) else { return };
        MAIN.store(main.0 as isize, Ordering::Relaxed);
        let taskbar_msg = RegisterWindowMessageW(w!("TaskbarCreated"));
        migrate_old_name();
        let hk = load_hotkeys();
        let (rect, locked, shown, per_game, obs_only) = load_window();
        let games = load_games();
        let lang = std::fs::read_to_string(data_dir().join("lang.txt")).unwrap_or_default().trim().to_string();
        app(|a| {
            a.main = main;
            a.taskbar_msg = taskbar_msg;
            a.icon = tray_icon();
            a.hk = hk;
            a.locked = locked;
            a.shown = shown;
            a.base = rect;
            a.per_game = per_game;
            a.games = games;
            a.obs_only = obs_only;
            a.lang = lang;
        });
        // Sent, not posted: /cmd answers after the command is done, so the page reads the new /state at once.
        if !net::start(Box::new(|q| {
            let h = HWND(MAIN.load(Ordering::Relaxed) as *mut c_void);
            let p = Box::into_raw(Box::new(q));
            SendMessageW(h, WM_CMD, Some(WPARAM(0)), Some(LPARAM(p as isize)));
        })) {
            MessageBoxW(None, &HSTRING::from(tr("Порт 8792 зайнятий: Foldback Chat не може запуститися.")), w!("Foldback Chat"), MB_ICONERROR);
            return;
        }
        tray(true);
        register_hotkeys();
        fix_autostart_path();
        // "With OBS": decided before the window shows, so starting with Windows doesn't flash the chat.
        if obs_only {
            let run = obs_running();
            app(|a| {
                a.shown = run;
                a.obs_seen = Some(run);
            });
        }
        create_overlay_window(rect);
        update_state();
        create_env();
        SetTimer(Some(main), TIMER_TOP, 2000, None);
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        tray(false);
    }
}

// ---------- persistence ----------

fn load_hotkeys() -> [String; 3] {
    let s = std::fs::read_to_string(data_dir().join("hotkeys.txt")).unwrap_or_default();
    let mut l = s.lines();
    std::array::from_fn(|i| l.next().map(str::trim).filter(|x| !x.is_empty()).unwrap_or(HK_DEFAULT[i]).to_string())
}

fn save_hotkeys() {
    let s = app(|a| a.hk.join("\n"));
    let _ = std::fs::write(data_dir().join("hotkeys.txt"), s);
}

/// window.txt "x y w h locked shown per_game obs_only": usual window rect in screen pixels and the flags.
/// Default: right side of the primary screen.
fn load_window() -> (RECT, bool, bool, bool, bool) {
    let s = std::fs::read_to_string(data_dir().join("window.txt")).unwrap_or_default();
    let v: Vec<i32> = s.split_whitespace().filter_map(|x| x.parse().ok()).collect();
    let flag = |i: usize| v.get(i).is_some_and(|&x| x != 0);
    if v.len() >= 6 && v[2] > 80 && v[3] > 80 {
        return (RECT { left: v[0], top: v[1], right: v[0] + v[2], bottom: v[1] + v[3] }, flag(4), flag(5), flag(6), flag(7));
    }
    (default_rect(), false, true, false, false)
}

/// games.txt: one line per game, "x y w h exe" (the exe name may contain spaces).
fn load_games() -> Vec<(String, RECT)> {
    let s = std::fs::read_to_string(data_dir().join("games.txt")).unwrap_or_default();
    s.lines()
        .filter_map(|l| {
            let mut it = l.splitn(5, ' ');
            let v: Vec<i32> = it.by_ref().take(4).filter_map(|x| x.parse().ok()).collect();
            let exe = it.next()?.trim().to_string();
            (v.len() == 4 && v[2] > 80 && v[3] > 80 && !exe.is_empty()).then(|| (exe, RECT { left: v[0], top: v[1], right: v[0] + v[2], bottom: v[1] + v[3] }))
        })
        .collect()
}

fn save_games() {
    let s = app(|a| a.games.iter().map(|(e, r)| format!("{} {} {} {} {e}\n", r.left, r.top, r.right - r.left, r.bottom - r.top)).collect::<String>());
    let _ = std::fs::write(data_dir().join("games.txt"), s);
}

fn default_rect() -> RECT {
    let (cx, sc) = unsafe { (GetSystemMetrics(SM_CXSCREEN), GetDpiForWindow(GetDesktopWindow()).max(96) as f64 / 96.0) };
    let (w, h) = ((420.0 * sc) as i32, (620.0 * sc) as i32);
    RECT { left: cx - w - (40.0 * sc) as i32, top: (140.0 * sc) as i32, right: cx - (40.0 * sc) as i32, bottom: (140.0 * sc) as i32 + h }
}

fn save_window() {
    let (r, locked, shown, per_game, obs_only) = app(|a| (a.base, a.locked, a.shown, a.per_game, a.obs_only));
    let _ = std::fs::write(
        data_dir().join("window.txt"),
        format!("{} {} {} {} {} {} {} {}", r.left, r.top, r.right - r.left, r.bottom - r.top, locked as u8, shown as u8, per_game as u8, obs_only as u8),
    );
}

/// "With OBS": the chat follows OBS — shown when it starts, hidden when it closes; in between the keys still work.
fn follow_obs() {
    if !app(|a| a.obs_only) {
        return;
    }
    let run = obs_running();
    if app(|a| a.obs_seen) == Some(run) {
        return;
    }
    app(|a| a.obs_seen = Some(run));
    set_shown(run);
}

/// OBS is found by its process name (works for an OBS running as administrator too).
fn obs_running() -> bool {
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return false };
        let mut pe = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut found = false;
        let mut more = Process32FirstW(snap, &mut pe).is_ok();
        while more {
            let n = pe.szExeFile.iter().position(|&c| c == 0).unwrap_or(pe.szExeFile.len());
            if matches!(String::from_utf16_lossy(&pe.szExeFile[..n]).to_ascii_lowercase().as_str(), "obs64.exe" | "obs32.exe" | "obs.exe") {
                found = true;
                break;
            }
            more = Process32NextW(snap, &mut pe).is_ok();
        }
        let _ = CloseHandle(snap);
        found
    }
}

fn set_obs_only(on: bool) {
    app(|a| {
        a.obs_only = on;
        a.obs_seen = None;
    });
    if on && !autostart() {
        set_autostart(true);
    }
    save_window();
    follow_obs();
    update_state();
}

/// The window was moved or resized by hand: that is the place of the current game, or the usual one.
fn store_rect() {
    let hwnd = app(|a| a.ov);
    let mut r = RECT::default();
    unsafe {
        let _ = GetWindowRect(hwnd, &mut r);
    }
    let game = app(|a| {
        if a.per_game && !a.game.is_empty() {
            let g = a.game.clone();
            match a.games.iter_mut().find(|(e, _)| *e == g) {
                Some(x) => x.1 = r,
                None => a.games.push((g, r)),
            }
            true
        } else {
            a.base = r;
            false
        }
    });
    if game {
        save_games();
        update_state();
    } else {
        save_window();
    }
}

fn move_overlay(r: RECT) {
    let hwnd = app(|a| a.ov);
    unsafe {
        let mut cur = RECT::default();
        let _ = GetWindowRect(hwnd, &mut cur);
        if cur != r {
            let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), r.left, r.top, r.right - r.left, r.bottom - r.top, SWP_NOACTIVATE);
        }
    }
}

/// Place for the current game, or the usual one.
fn place_for_game() -> RECT {
    app(|a| a.games.iter().find(|(e, _)| a.per_game && !a.game.is_empty() && *e == a.game).map(|x| x.1).unwrap_or(a.base))
}

/// Per-game places: follows the foreground window. A game is a window without a title bar that covers its
/// whole monitor (borderless or fullscreen); our own windows leave the current game as it is.
fn follow_game() {
    if !app(|a| a.per_game) {
        return;
    }
    let Some(key) = foreground_game() else { return };
    if app(|a| a.game == key) {
        return;
    }
    app(|a| a.game = key);
    move_overlay(place_for_game());
    update_state();
}

/// Some("") — no game in front, Some(exe) — a game, None — one of our windows is in front.
fn foreground_game() -> Option<String> {
    unsafe {
        let fg = GetForegroundWindow();
        if fg.is_invalid() {
            return Some(String::new());
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(fg, Some(&mut pid));
        if pid == GetCurrentProcessId() {
            return None;
        }
        if !IsWindowVisible(fg).as_bool() || IsIconic(fg).as_bool() {
            return Some(String::new());
        }
        let mut cls = [0u16; 64];
        let n = GetClassNameW(fg, &mut cls) as usize;
        let cls = String::from_utf16_lossy(&cls[..n]);
        if matches!(cls.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd") {
            return Some(String::new());
        }
        let style = GetWindowLongPtrW(fg, GWL_STYLE) as u32;
        if style & WS_CAPTION.0 == WS_CAPTION.0 {
            return Some(String::new());
        }
        let mut r = RECT::default();
        let _ = GetWindowRect(fg, &mut r);
        let m = monitor_rect(fg);
        if r.left > m.left || r.top > m.top || r.right < m.right || r.bottom < m.bottom {
            return Some(String::new());
        }
        Some(exe_name(pid).unwrap_or_default())
    }
}

fn exe_name(pid: u32) -> Option<String> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 512];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(h);
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        ok.then(|| path.rsplit('\\').next().unwrap_or_default().to_lowercase()).filter(|s| !s.is_empty())
    }
}

fn set_per_game(on: bool) {
    app(|a| {
        a.per_game = on;
        a.game.clear();
    });
    move_overlay(place_for_game());
    save_window();
    update_state();
}

fn forget_game(exe: &str) {
    let here = app(|a| {
        a.games.retain(|(e, _)| e != exe);
        a.game == exe
    });
    save_games();
    if here {
        move_overlay(place_for_game());
    }
    update_state();
}

fn autostart() -> bool {
    unsafe { RegGetValueW(HKEY_CURRENT_USER, RUN_KEY, w!("Foldback Chat"), RRF_RT_REG_SZ, None, None, None) == ERROR_SUCCESS }
}

/// The exe may have been moved since autostart was turned on: point it at this one.
fn fix_autostart_path() {
    if autostart() {
        set_autostart(true);
    }
}

fn set_autostart(on: bool) {
    unsafe {
        if on {
            let exe = std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default();
            let v: Vec<u16> = format!("\"{exe}\"").encode_utf16().chain([0]).collect();
            let _ = RegSetKeyValueW(HKEY_CURRENT_USER, RUN_KEY, w!("Foldback Chat"), REG_SZ.0, Some(v.as_ptr() as *const c_void), (v.len() * 2) as u32);
        } else {
            let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, RUN_KEY, w!("Foldback Chat"));
        }
    }
}

/// Host state for the pages (/state), also pushed to the overlay.
fn update_state() {
    let (locked, shown, hk, per_game, game, games, obs_only, busy) = app(|a| (a.locked, a.shown, a.hk.clone(), a.per_game, a.game.clone(), a.games.iter().map(|g| g.0.clone()).collect::<Vec<_>>(), a.obs_only, a.hk_busy));
    let esc = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
    let games = games.iter().map(|g| format!("\"{}\"", esc(g))).collect::<Vec<_>>().join(",");
    let json = format!(
        "{{\"locked\":{locked},\"shown\":{shown},\"autostart\":{},\"hk\":[\"{}\",\"{}\",\"{}\"],\"hkbusy\":[{},{},{}],\"pergame\":{per_game},\"game\":\"{}\",\"games\":[{games}],\"obsonly\":{obs_only},\"version\":\"{}\",\"port\":{}}}",
        autostart(),
        esc(&hk[0]),
        esc(&hk[1]),
        esc(&hk[2]),
        busy[0],
        busy[1],
        busy[2],
        esc(&game),
        env!("CARGO_PKG_VERSION"),
        net::PORT
    );
    *net::STATE.lock().unwrap() = json.clone();
    exec_overlay(&format!("window.fcHost&&fcHost({json})"));
}

// ---------- hotkeys ----------

fn parse_hotkey(s: &str) -> Option<(HOT_KEY_MODIFIERS, u32)> {
    let mut m = HOT_KEY_MODIFIERS(0);
    let mut key = None;
    for t in s.split('+').map(|t| t.trim().to_ascii_uppercase()) {
        match t.as_str() {
            "CTRL" | "CONTROL" => m |= MOD_CONTROL,
            "ALT" => m |= MOD_ALT,
            "SHIFT" => m |= MOD_SHIFT,
            "WIN" => m |= MOD_WIN,
            k if k.len() == 1 && k.chars().all(|c| c.is_ascii_alphanumeric()) => key = Some(k.as_bytes()[0] as u32),
            k if k.starts_with('F') && k[1..].parse::<u32>().is_ok_and(|n| (1..=24).contains(&n)) => key = Some(0x70 + k[1..].parse::<u32>().unwrap() - 1),
            _ => return None,
        }
    }
    key.filter(|_| m.0 != 0).map(|k| (m, k))
}

/// "-" is no key. A key another app already holds can't be registered: `hk_busy` tells the settings page.
fn register_hotkeys() {
    let (main, hk) = app(|a| (a.main, a.hk.clone()));
    let mut busy = [false; 3];
    for (i, s) in hk.iter().enumerate() {
        unsafe {
            let _ = UnregisterHotKey(Some(main), i as i32 + 1);
            if let Some((m, vk)) = parse_hotkey(s) {
                busy[i] = RegisterHotKey(Some(main), i as i32 + 1, m | MOD_NOREPEAT, vk).is_err();
            }
        }
    }
    app(|a| a.hk_busy = busy);
}

// ---------- tray ----------

fn tray(add: bool) {
    tray_msg(if add { NIM_ADD } else { NIM_DELETE });
}

fn tray_msg(op: NOTIFY_ICON_MESSAGE) {
    let (main, icon) = app(|a| (a.main, a.icon));
    let mut nid = NOTIFYICONDATAW { cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32, hWnd: main, uID: 1, uFlags: NIF_MESSAGE | NIF_ICON | NIF_TIP, uCallbackMessage: WM_TRAY, hIcon: icon, ..Default::default() };
    for (i, c) in "Foldback Chat".encode_utf16().enumerate() {
        nid.szTip[i] = c;
    }
    unsafe {
        let _ = Shell_NotifyIconW(op, &nid);
    }
}

/// Light taskbar (Windows "apps / system" light mode for the taskbar).
fn taskbar_light() -> bool {
    let mut v = 0u32;
    let mut n = 4u32;
    unsafe {
        RegGetValueW(HKEY_CURRENT_USER, w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"), w!("SystemUsesLightTheme"), RRF_RT_REG_DWORD, None, Some(&mut v as *mut u32 as *mut c_void), Some(&mut n)) == ERROR_SUCCESS && v != 0
    }
}

/// The leaf alone, light on a dark taskbar and dark on a light one (icon groups 2 / 3, see build.rs).
fn tray_icon() -> HICON {
    unsafe {
        let inst = GetModuleHandleW(None).unwrap_or_default();
        let id = if taskbar_light() { 3 } else { 2 };
        LoadImageW(Some(inst.into()), PCWSTR(id as *const u16), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), LR_DEFAULTCOLOR).map(|h| HICON(h.0)).unwrap_or_default()
    }
}

/// The taskbar switched between light and dark.
fn tray_theme() {
    let icon = tray_icon();
    if icon.is_invalid() {
        return;
    }
    let old = app(|a| std::mem::replace(&mut a.icon, icon));
    tray_msg(NIM_MODIFY);
    unsafe {
        let _ = DestroyIcon(old);
    }
}

fn tray_menu() {
    let (main, shown, locked) = app(|a| (a.main, a.shown, a.locked));
    unsafe {
        let Ok(m) = CreatePopupMenu() else { return };
        let ck = |on: bool| if on { MF_STRING | MF_CHECKED } else { MF_STRING };
        let item = |flags, id, s: &'static str| {
            let _ = AppendMenuW(m, flags, id, &HSTRING::from(tr(s)));
        };
        item(MF_STRING, 1, "Налаштування");
        item(ck(shown), 2, "Показувати чат");
        item(ck(locked), 3, "Закріпити (клацання крізь чат)");
        item(MF_STRING, 4, "Повернути вікно на місце");
        let _ = AppendMenuW(m, MF_SEPARATOR, 0, PCWSTR::null());
        item(MF_STRING, 9, "Вихід");
        let mut pt = POINT::default();
        let _ = GetCursorPos(&mut pt);
        let _ = SetForegroundWindow(main);
        let id = TrackPopupMenu(m, TPM_RETURNCMD | TPM_RIGHTBUTTON | TPM_NONOTIFY, pt.x, pt.y, None, main, None).0;
        let _ = DestroyMenu(m);
        match id {
            1 => open_settings(),
            2 => set_shown(!shown),
            3 => set_locked(!locked),
            4 => reset_position(),
            9 => quit(),
            _ => {}
        }
    }
}

fn quit() {
    save_window();
    unsafe {
        PostQuitMessage(0);
    }
}

// ---------- commands from the pages ----------

fn command(q: &str) {
    let v = net::param(q, "v").unwrap_or_default();
    let flag = |cur: bool| match v.as_str() {
        "1" | "true" => true,
        "0" | "false" => false,
        _ => !cur,
    };
    match net::param(q, "c").as_deref() {
        Some("settings") => open_settings(),
        Some("lock") => set_locked(flag(app(|a| a.locked))),
        Some("show") => set_shown(flag(app(|a| a.shown))),
        Some("resetpos") => reset_position(),
        Some("autostart") => {
            set_autostart(flag(autostart()));
            update_state();
        }
        Some("pergame") => set_per_game(flag(app(|a| a.per_game))),
        Some("forget") => forget_game(&v),
        Some("obsonly") => set_obs_only(flag(app(|a| a.obs_only))),
        Some("hkreset") => {
            app(|a| a.hk = HK_DEFAULT.map(String::from));
            save_hotkeys();
            register_hotkeys();
            update_state();
        }
        Some("lang") if v.len() == 2 && v.bytes().all(|b| b.is_ascii_lowercase()) => {
            app(|a| a.lang = v.clone());
            let _ = std::fs::write(data_dir().join("lang.txt"), &v);
            let set = app(|a| a.set);
            if !set.is_invalid() {
                unsafe {
                    let _ = SetWindowTextW(set, &HSTRING::from(tr("Foldback Chat — налаштування")));
                }
            }
        }
        // Only the app's own pages, never an address from the page.
        Some("open") => {
            let url = match v.as_str() {
                "repo" => REPO.to_string(),
                "releases" => format!("{REPO}/releases/latest"),
                _ => return,
            };
            unsafe {
                ShellExecuteW(None, w!("open"), &HSTRING::from(url), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL);
            }
        }
        Some("hk") => {
            if let Some(i) = net::param(q, "id").and_then(|s| s.parse::<usize>().ok()).filter(|&i| i < 3) {
                // A key another action already uses: the two swap, as nothing may hold one key twice.
                app(|a| {
                    let old = std::mem::replace(&mut a.hk[i], v.clone());
                    if v != "-"
                        && let Some(j) = (0..3).find(|&j| j != i && a.hk[j].eq_ignore_ascii_case(&v))
                    {
                        a.hk[j] = old;
                    }
                });
                save_hotkeys();
                register_hotkeys();
                update_state();
            }
        }
        Some("quit") => quit(),
        _ => {}
    }
}

// ---------- overlay window ----------

fn create_overlay_window(r: RECT) {
    let (locked, shown) = app(|a| (a.locked, a.shown));
    let mut ex = WS_EX_NOREDIRECTIONBITMAP | WS_EX_TOPMOST | WS_EX_TOOLWINDOW;
    if locked {
        ex |= WS_EX_LAYERED | WS_EX_TRANSPARENT;
    }
    unsafe {
        let inst = GetModuleHandleW(None).unwrap_or_default();
        let Ok(hwnd) = CreateWindowExW(ex, w!("FoldbackChatOverlay"), w!("Foldback Chat"), WS_POPUP, r.left, r.top, r.right - r.left, r.bottom - r.top, None, None, Some(inst.into()), None) else { return };
        if locked {
            let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 255, LWA_ALPHA);
        }
        app(|a| a.ov = hwnd);
        if shown {
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
    }
}

fn set_bounds(ctl: &ICoreWebView2Controller, hwnd: HWND) {
    unsafe {
        let mut rc = RECT::default();
        let _ = GetClientRect(hwnd, &mut rc);
        let _ = ctl.SetBounds(rc);
    }
}

fn set_locked(v: bool) {
    let hwnd = app(|a| {
        a.locked = v;
        a.ov
    });
    unsafe {
        let mut ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let f = (WS_EX_LAYERED | WS_EX_TRANSPARENT).0;
        if v { ex |= f } else { ex &= !f }
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex as isize);
        if v {
            let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 255, LWA_ALPHA);
        }
        let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    }
    passthrough_webview();
    save_window();
    update_state();
}

fn set_shown(v: bool) {
    let (hwnd, ctl) = app(|a| {
        a.shown = v;
        (a.ov, a.ov_ctl.clone())
    });
    unsafe {
        let _ = ShowWindow(hwnd, if v { SW_SHOWNOACTIVATE } else { SW_HIDE });
        if let Some(c) = ctl {
            let _ = c.SetIsVisible(v);
        }
    }
    save_window();
    update_state();
}

/// Back to the default place: the usual one, or the current game's when it has its own.
fn reset_position() {
    move_overlay(default_rect());
    store_rect();
    set_shown(true);
}

/// Visual hosting puts a WebView2 input popup (another process, same rect) under the overlay; it would
/// catch the clicks of a locked overlay, so it is made transparent to the mouse too. Input is never
/// forwarded to the overlay page anyway.
fn passthrough_webview() {
    let (ov, wv) = app(|a| (a.ov, a.ov_wv.clone()));
    let Some(wv) = wv else { return };
    unsafe {
        let mut pid = 0u32;
        if wv.BrowserProcessId(&mut pid).is_err() || pid == 0 {
            return;
        }
        let mut r = RECT::default();
        let _ = GetWindowRect(ov, &mut r);
        let mut found: Vec<HWND> = Vec::new();
        let _ = EnumWindows(Some(collect), LPARAM(&mut found as *mut Vec<HWND> as isize));
        for h in found {
            let mut p = 0u32;
            GetWindowThreadProcessId(h, Some(&mut p));
            let mut wr = RECT::default();
            let _ = GetWindowRect(h, &mut wr);
            if p != pid || wr.left != r.left || wr.top != r.top || wr.right != r.right || wr.bottom != r.bottom {
                continue;
            }
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE) as u32;
            let want = ex | WS_EX_TRANSPARENT.0 | WS_EX_LAYERED.0;
            if ex != want {
                SetWindowLongPtrW(h, GWL_EXSTYLE, want as isize);
            }
        }
    }
}

extern "system" fn collect(h: HWND, lp: LPARAM) -> windows::core::BOOL {
    unsafe { (*(lp.0 as *mut Vec<HWND>)).push(h) };
    true.into()
}

fn exec_overlay(js: &str) {
    if let Some(wv) = app(|a| a.ov_wv.clone()) {
        unsafe {
            let _ = wv.ExecuteScript(&HSTRING::from(js), None::<&ICoreWebView2ExecuteScriptCompletedHandler>);
        }
    }
}

// ---------- WebView2 ----------

fn create_env() {
    let data = HSTRING::from(webview_dir().as_os_str());
    let opts = CoreWebView2EnvironmentOptions::default();
    unsafe {
        opts.set_additional_browser_arguments("--autoplay-policy=no-user-gesture-required".to_string());
    }
    let opts: ICoreWebView2EnvironmentOptions = opts.into();
    let h = CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(|res, env| {
        match env.filter(|_| res.is_ok()) {
            Some(env) => {
                app(|a| a.env = Some(env.clone()));
                if create_overlay_view(env).is_err() {
                    fatal("Не вдалося створити вікно чату (WebView2).");
                }
                if app(|a| a.set_pending) {
                    open_settings();
                }
            }
            None => fatal("Потрібен Microsoft Edge WebView2 Runtime."),
        }
        Ok(())
    }));
    unsafe {
        if CreateCoreWebView2EnvironmentWithOptions(PCWSTR::null(), &data, &opts, &h).is_err() {
            fatal("Потрібен Microsoft Edge WebView2 Runtime.");
        }
    }
}

fn fatal(msg: &'static str) {
    unsafe {
        MessageBoxW(None, &HSTRING::from(tr(msg)), w!("Foldback Chat"), MB_ICONERROR);
        PostQuitMessage(1);
    }
}

fn page_settings(wv: &ICoreWebView2) {
    unsafe {
        if let Ok(st) = wv.Settings() {
            let _ = st.SetIsZoomControlEnabled(false);
            let _ = st.SetIsStatusBarEnabled(false);
            #[cfg(not(debug_assertions))]
            {
                let _ = st.SetAreDevToolsEnabled(false);
                let _ = st.SetAreDefaultContextMenusEnabled(false);
                if let Ok(s3) = st.cast::<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3>() {
                    let _ = s3.SetAreBrowserAcceleratorKeysEnabled(false);
                }
            }
        }
    }
}

fn url(page: &str) -> HSTRING {
    HSTRING::from(format!("http://127.0.0.1:{}/{page}", net::PORT))
}

/// Overlay: composition (visual) hosting, so the transparent page shows the game through.
fn create_overlay_view(env: ICoreWebView2Environment) -> windows::core::Result<()> {
    let hwnd = app(|a| a.ov);
    unsafe {
        let dev: IDCompositionDesktopDevice = DCompositionCreateDevice2(None::<&IUnknown>)?;
        let target = dev.CreateTargetForHwnd(hwnd, true)?;
        let visual = dev.CreateVisual()?;
        target.SetRoot(&visual)?;
        let env3: ICoreWebView2Environment3 = env.cast()?;
        let h = CreateCoreWebView2CompositionControllerCompletedHandler::create(Box::new(move |res, comp| {
            let Some(comp) = comp.filter(|_| res.is_ok()) else {
                fatal("Не вдалося створити вікно чату (WebView2).");
                return Ok(());
            };
            comp.SetRootVisualTarget(&visual)?;
            dev.Commit()?;
            let ctl: ICoreWebView2Controller = comp.cast()?;
            if let Ok(c2) = ctl.cast::<ICoreWebView2Controller2>() {
                let _ = c2.SetDefaultBackgroundColor(COREWEBVIEW2_COLOR { A: 0, R: 0, G: 0, B: 0 });
            }
            set_bounds(&ctl, hwnd);
            let wv = ctl.CoreWebView2()?;
            page_settings(&wv);
            let shown = app(|a| a.shown);
            let _ = ctl.SetIsVisible(shown);
            wv.Navigate(&url("overlay"))?;
            app(|a| {
                a.ov_ctl = Some(ctl.clone());
                a.ov_wv = Some(wv.clone());
                a.dcomp = Some((dev.clone(), target.clone(), visual.clone()));
            });
            Ok(())
        }));
        env3.CreateCoreWebView2CompositionController(hwnd, &h)
    }
}

fn open_settings() {
    let Some(env) = app(|a| a.env.clone()) else {
        app(|a| a.set_pending = true);
        return;
    };
    app(|a| a.set_pending = false);
    let mut hwnd = app(|a| a.set);
    unsafe {
        if hwnd.is_invalid() {
            let inst = GetModuleHandleW(None).unwrap_or_default();
            let sc = GetDpiForWindow(GetDesktopWindow()).max(96) as f64 / 96.0;
            let (w, h) = ((1040.0 * sc) as i32, (780.0 * sc) as i32);
            let title = HSTRING::from(tr("Foldback Chat — налаштування"));
            let Ok(created) = CreateWindowExW(WINDOW_EX_STYLE(0), w!("FoldbackChatSettings"), &title, WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT, w, h, None, None, Some(inst.into()), None) else {
                return;
            };
            hwnd = created;
            let dark = windows::core::BOOL(1);
            let _ = DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark as *const _ as *const c_void, 4);
            // Title bar in the page's colours (Windows 11; older systems keep the dark one).
            for (attr, c) in [(DWMWA_CAPTION_COLOR, 0x0010_0f0fu32), (DWMWA_TEXT_COLOR, 0x00ef_eded), (DWMWA_BORDER_COLOR, 0x0020_1d1d)] {
                let _ = DwmSetWindowAttribute(hwnd, attr, &c as *const u32 as *const c_void, 4);
            }
            app(|a| a.set = hwnd);
        }
        let _ = ShowWindow(hwnd, SW_SHOWNORMAL);
        let _ = SetForegroundWindow(hwnd);
    }
    let (ctl, creating) = app(|a| (a.set_ctl.clone(), a.set_creating));
    if let Some(c) = ctl {
        unsafe {
            let _ = c.SetIsVisible(true);
        }
        return;
    }
    if creating {
        return;
    }
    app(|a| a.set_creating = true);
    let h = CreateCoreWebView2ControllerCompletedHandler::create(Box::new(move |res, ctl| {
        app(|a| a.set_creating = false);
        let Some(ctl) = ctl.filter(|_| res.is_ok()) else { return Ok(()) };
        if let Ok(c2) = ctl.cast::<ICoreWebView2Controller2>() {
            let _ = unsafe { c2.SetDefaultBackgroundColor(COREWEBVIEW2_COLOR { A: 255, R: 0x0f, G: 0x0f, B: 0x10 }) };
        }
        set_bounds(&ctl, hwnd);
        unsafe {
            let wv = ctl.CoreWebView2()?;
            page_settings(&wv);
            wv.Navigate(&url("settings"))?;
        }
        app(|a| a.set_ctl = Some(ctl));
        Ok(())
    }));
    unsafe {
        let _ = env.CreateCoreWebView2Controller(hwnd, &h);
    }
}

// ---------- window procedures ----------

extern "system" fn main_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_TRAY => {
                match (lp.0 & 0xffff) as u32 {
                    WM_LBUTTONUP => {
                        let s = app(|a| a.shown);
                        set_shown(!s);
                    }
                    WM_RBUTTONUP | WM_CONTEXTMENU => tray_menu(),
                    _ => {}
                }
                LRESULT(0)
            }
            WM_HOTKEY => {
                match wp.0 {
                    1 => set_shown(!app(|a| a.shown)),
                    2 => set_locked(!app(|a| a.locked)),
                    3 => open_settings(),
                    _ => {}
                }
                LRESULT(0)
            }
            WM_CMD => {
                let q = Box::from_raw(lp.0 as *mut String);
                command(&q);
                LRESULT(0)
            }
            WM_OPEN => {
                open_settings();
                LRESULT(0)
            }
            WM_TIMER if wp.0 == TIMER_TOP => {
                follow_obs();
                // Games in borderless windows can climb above; keep the chat on top.
                let (ov, shown) = app(|a| (a.ov, a.shown));
                if shown {
                    let _ = SetWindowPos(ov, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                    follow_game();
                    passthrough_webview();
                }
                LRESULT(0)
            }
            WM_SETTINGCHANGE => {
                if lp.0 != 0 && PCWSTR(lp.0 as *const u16).to_string().is_ok_and(|s| s == "ImmersiveColorSet") {
                    tray_theme();
                }
                DefWindowProcW(hwnd, msg, wp, lp)
            }
            m if m != 0 && m == app(|a| a.taskbar_msg) => {
                tray(true);
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, msg, wp, lp),
        }
    }
}

extern "system" fn overlay_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_NCHITTEST => {
                if app(|a| a.locked) {
                    return LRESULT(HTTRANSPARENT as isize);
                }
                // Unlocked: drag anywhere, resize at the edges.
                let (x, y) = ((lp.0 & 0xffff) as i16 as i32, ((lp.0 >> 16) & 0xffff) as i16 as i32);
                let mut r = RECT::default();
                let _ = GetWindowRect(hwnd, &mut r);
                let b = (10 * GetDpiForWindow(hwnd).max(96) / 96) as i32;
                let (l, t, rt, bm) = (x < r.left + b, y < r.top + b, x >= r.right - b, y >= r.bottom - b);
                let ht = match (l, t, rt, bm) {
                    (true, true, _, _) => HTTOPLEFT,
                    (_, true, true, _) => HTTOPRIGHT,
                    (true, _, _, true) => HTBOTTOMLEFT,
                    (_, _, true, true) => HTBOTTOMRIGHT,
                    (true, _, _, _) => HTLEFT,
                    (_, _, true, _) => HTRIGHT,
                    (_, true, _, _) => HTTOP,
                    (_, _, _, true) => HTBOTTOM,
                    _ => HTCAPTION,
                };
                LRESULT(ht as isize)
            }
            WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
            // Unlocked: the wheel scrolls the chat history (input is not forwarded to the page itself).
            WM_MOUSEWHEEL => {
                if !app(|a| a.locked) {
                    exec_overlay(&format!("window.fcWheel&&fcWheel({})", (wp.0 >> 16) as u16 as i16));
                }
                LRESULT(0)
            }
            // Resizing by hand: the page renders a frame or two after the window changes, so a live resize
            // stretches or clips it. Instead an outline follows the drag and the window takes the size at the end.
            WM_SIZING => {
                let r = *(lp.0 as *const RECT);
                app(|a| {
                    a.sizing = true;
                    a.size_to = r;
                });
                show_frame(r);
                LRESULT(1)
            }
            // The page gets its new size before the window changes, not one message later. The window has no
            // frame: client = window.
            WM_WINDOWPOSCHANGING => {
                let wp_ = &mut *(lp.0 as *mut WINDOWPOS);
                if !wp_.flags.contains(SWP_NOSIZE) {
                    if app(|a| a.sizing) {
                        wp_.flags |= SWP_NOSIZE | SWP_NOMOVE;
                    } else if wp_.cx > 0
                        && wp_.cy > 0
                        && let Some(c) = app(|a| a.ov_ctl.clone())
                    {
                        let _ = c.SetBounds(RECT { left: 0, top: 0, right: wp_.cx, bottom: wp_.cy });
                    }
                }
                DefWindowProcW(hwnd, msg, wp, lp)
            }
            WM_MOVE => {
                if let Some(c) = app(|a| a.ov_ctl.clone()) {
                    let _ = c.NotifyParentWindowPositionChanged();
                }
                LRESULT(0)
            }
            WM_SIZE => {
                if let Some(c) = app(|a| a.ov_ctl.clone()) {
                    set_bounds(&c, hwnd);
                }
                LRESULT(0)
            }
            WM_EXITSIZEMOVE => {
                if app(|a| std::mem::take(&mut a.sizing)) {
                    hide_frame();
                    move_overlay(app(|a| a.size_to));
                }
                store_rect();
                passthrough_webview();
                LRESULT(0)
            }
            WM_DPICHANGED => {
                let r = &*(lp.0 as *const RECT);
                let _ = SetWindowPos(hwnd, None, r.left, r.top, r.right - r.left, r.bottom - r.top, SWP_NOZORDER | SWP_NOACTIVATE);
                LRESULT(0)
            }
            WM_GETMINMAXINFO => {
                let mi = &mut *(lp.0 as *mut MINMAXINFO);
                mi.ptMinTrackSize = POINT { x: 200, y: 160 };
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, msg, wp, lp),
        }
    }
}

/// Outline shown while the chat is resized by hand: a click-through topmost window, magenta keyed out.
fn show_frame(r: RECT) {
    let mut f = app(|a| a.frame);
    unsafe {
        if f.is_invalid() {
            let inst = GetModuleHandleW(None).unwrap_or_default();
            let ex = WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
            let Ok(h) = CreateWindowExW(ex, w!("FoldbackChatFrame"), w!(""), WS_POPUP, r.left, r.top, r.right - r.left, r.bottom - r.top, None, None, Some(inst.into()), None) else { return };
            let _ = SetLayeredWindowAttributes(h, COLORREF(0x00ff_00ff), 0, LWA_COLORKEY);
            app(|a| a.frame = h);
            f = h;
        }
        let _ = SetWindowPos(f, Some(HWND_TOPMOST), r.left, r.top, r.right - r.left, r.bottom - r.top, SWP_NOACTIVATE | SWP_SHOWWINDOW);
        let _ = InvalidateRect(Some(f), None, false);
    }
}

fn hide_frame() {
    let f = app(|a| a.frame);
    if !f.is_invalid() {
        unsafe {
            let _ = ShowWindow(f, SW_HIDE);
        }
    }
}

extern "system" fn frame_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_PAINT => {
                let mut ps = PAINTSTRUCT::default();
                let dc = BeginPaint(hwnd, &mut ps);
                let mut rc = RECT::default();
                let _ = GetClientRect(hwnd, &mut rc);
                let key = CreateSolidBrush(COLORREF(0x00ff_00ff));
                FillRect(dc, &rc, key);
                let line = CreateSolidBrush(COLORREF(0x00e8_e8e8));
                for i in 0..(2 * GetDpiForWindow(hwnd).max(96) / 96) as i32 {
                    FrameRect(dc, &RECT { left: rc.left + i, top: rc.top + i, right: rc.right - i, bottom: rc.bottom - i }, line);
                }
                let _ = DeleteObject(HGDIOBJ(key.0));
                let _ = DeleteObject(HGDIOBJ(line.0));
                let _ = EndPaint(hwnd, &ps);
                LRESULT(0)
            }
            WM_ERASEBKGND => LRESULT(1),
            WM_NCHITTEST => LRESULT(HTTRANSPARENT as isize),
            _ => DefWindowProcW(hwnd, msg, wp, lp),
        }
    }
}

extern "system" fn settings_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_SIZE => {
                if let Some(c) = app(|a| a.set_ctl.clone()) {
                    set_bounds(&c, hwnd);
                }
                LRESULT(0)
            }
            WM_CLOSE => {
                // Hidden, not destroyed: opens instantly next time.
                let _ = ShowWindow(hwnd, SW_HIDE);
                if let Some(c) = app(|a| a.set_ctl.clone()) {
                    let _ = c.SetIsVisible(false);
                }
                LRESULT(0)
            }
            WM_GETMINMAXINFO => {
                let mi = &mut *(lp.0 as *mut MINMAXINFO);
                mi.ptMinTrackSize = POINT { x: 720, y: 520 };
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, msg, wp, lp),
        }
    }
}

fn monitor_rect(hwnd: HWND) -> RECT {
    unsafe {
        let m = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        let _ = GetMonitorInfoW(m, &mut mi);
        mi.rcMonitor
    }
}
