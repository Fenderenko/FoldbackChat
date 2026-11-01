//! Local HTTP server on 127.0.0.1 (plain std, one thread per connection) and a small WinHTTP client.
//! Routes: the pages (embedded in release, read from web/ in debug), /events (SSE fan-out of /push,
//! used by the OBS scenes), /proxy (YouTube requests with a consent cookie), /cmd and /state (host).

use std::{
    ffi::c_void,
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    sync::{Mutex, OnceLock},
    thread,
    time::Duration,
};

use windows::{
    Win32::Foundation::LPARAM,
    Win32::Graphics::Gdi::{DEFAULT_CHARSET, EnumFontFamiliesExW, GetDC, LOGFONTW, ReleaseDC, TEXTMETRICW},
    Win32::Networking::WinHttp::{
        INTERNET_DEFAULT_HTTPS_PORT, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_FLAG_SECURE, WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_QUERY_STATUS_CODE, WinHttpCloseHandle, WinHttpConnect,
        WinHttpOpen, WinHttpOpenRequest, WinHttpQueryHeaders, WinHttpReadData, WinHttpReceiveResponse, WinHttpSendRequest, WinHttpSetTimeouts,
    },
    core::{HSTRING, PCWSTR},
};

pub const PORT: u16 = 8792;

/// SSE subscribers (OBS scenes); a write error drops the client.
static CLIENTS: Mutex<Vec<TcpStream>> = Mutex::new(Vec::new());
/// Host state as JSON for /state, kept current by the UI thread.
pub static STATE: Mutex<String> = Mutex::new(String::new());
/// Commands for the UI thread (posted as a window message by the caller).
static CMD: OnceLock<Box<dyn Fn(String) + Send + Sync>> = OnceLock::new();

pub fn start(on_cmd: Box<dyn Fn(String) + Send + Sync>) -> bool {
    let _ = CMD.set(on_cmd);
    let Ok(l) = TcpListener::bind(("127.0.0.1", PORT)) else { return false };
    thread::spawn(move || {
        for s in l.incoming().flatten() {
            thread::spawn(move || {
                let _ = handle(s);
            });
        }
    });
    // Keep-alive comments so dead SSE clients are found and dropped.
    thread::spawn(|| loop {
        thread::sleep(Duration::from_secs(20));
        broadcast_raw(b": ping\n\n");
    });
    true
}

fn broadcast_raw(b: &[u8]) {
    let mut c = CLIENTS.lock().unwrap();
    c.retain_mut(|s| s.write_all(b).and_then(|_| s.flush()).is_ok());
}

fn page(name: &str) -> Option<(Vec<u8>, &'static str)> {
    let ct = match name.rsplit('.').next()? {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "png" => "image/png",
        _ => return None,
    };
    #[cfg(debug_assertions)]
    {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let p = if name == "icon.png" { root.join("assets").join("icon256.png") } else { root.join("web").join(name) };
        return std::fs::read(p).ok().map(|b| (b, ct));
    }
    #[cfg(not(debug_assertions))]
    {
        let b: &[u8] = match name {
            "overlay.html" => include_bytes!("../web/overlay.html"),
            "settings.html" => include_bytes!("../web/settings.html"),
            "style.css" => include_bytes!("../web/style.css"),
            "common.js" => include_bytes!("../web/common.js"),
            "i18n.js" => include_bytes!("../web/i18n.js"),
            "overlay.js" => include_bytes!("../web/overlay.js"),
            "settings.js" => include_bytes!("../web/settings.js"),
            "icon.png" => include_bytes!("../assets/icon256.png"),
            _ => return None,
        };
        Some((b.to_vec(), ct))
    }
}

fn respond(s: &mut TcpStream, code: &str, ct: &str, body: &[u8]) -> std::io::Result<()> {
    let h = format!(
        "HTTP/1.1 {code}\r\nContent-Type: {ct}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: *\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    s.write_all(h.as_bytes())?;
    s.write_all(body)
}

fn handle(mut s: TcpStream) -> std::io::Result<()> {
    let mut r = BufReader::new(s.try_clone()?);
    let mut line = String::new();
    r.read_line(&mut line)?;
    let mut it = line.split_whitespace();
    let (method, target) = (it.next().unwrap_or("").to_string(), it.next().unwrap_or("/").to_string());
    let mut len = 0usize;
    loop {
        let mut h = String::new();
        if r.read_line(&mut h)? == 0 || h == "\r\n" || h == "\n" {
            break;
        }
        if let Some((k, v)) = h.split_once(':')
            && k.eq_ignore_ascii_case("content-length")
        {
            len = v.trim().parse().unwrap_or(0).min(1 << 20);
        }
    }
    let mut body = vec![0u8; len];
    r.read_exact(&mut body)?;
    let (path, query) = target.split_once('?').unwrap_or((&target, ""));

    if method == "OPTIONS" {
        return respond(&mut s, "204 No Content", "text/plain", b"");
    }
    match path {
        "/" | "/overlay" => serve(&mut s, "overlay.html"),
        "/settings" => serve(&mut s, "settings.html"),
        "/events" => {
            s.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: keep-alive\r\n\r\n: hi\n\n")?;
            s.flush()?;
            CLIENTS.lock().unwrap().push(s);
            Ok(())
        }
        "/push" => {
            // One JSON object per call; SSE data lines must not contain newlines.
            let text = String::from_utf8_lossy(&body).replace(['\r', '\n'], " ");
            broadcast_raw(format!("data: {text}\n\n").as_bytes());
            respond(&mut s, "204 No Content", "text/plain", b"")
        }
        "/state" => {
            let st = STATE.lock().unwrap().clone();
            respond(&mut s, "200 OK", "application/json", st.as_bytes())
        }
        "/cmd" => {
            if let Some(f) = CMD.get() {
                f(query.to_string());
            }
            respond(&mut s, "200 OK", "text/plain", b"ok")
        }
        "/update" => respond(&mut s, "200 OK", "application/json", update_check().as_bytes()),
        "/fonts" => respond(&mut s, "200 OK", "application/json", system_fonts().as_bytes()),
        "/proxy" => {
            let url = param(query, "u").unwrap_or_default();
            match proxy(&method, &url, &body) {
                Ok((code, b)) => respond(&mut s, &format!("{code} OK"), "text/plain; charset=utf-8", &b),
                Err(e) => respond(&mut s, "502 Bad Gateway", "text/plain", e.as_bytes()),
            }
        }
        _ => serve(&mut s, path.trim_start_matches('/')),
    }
}

fn serve(s: &mut TcpStream, name: &str) -> std::io::Result<()> {
    match page(name) {
        Some((b, ct)) => respond(s, "200 OK", ct, &b),
        None => respond(s, "404 Not Found", "text/plain", b"not found"),
    }
}

/// A query parameter, percent-decoded.
pub fn param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == key).then(|| decode(v))
    })
}

fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < b.len() => {
                if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(v);
                    i += 2;
                } else {
                    out.push(b'%');
                }
            }
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// YouTube only: the page reads live chat through here (no CORS, consent cookie set).
fn proxy(method: &str, url: &str, body: &[u8]) -> Result<(u16, Vec<u8>), String> {
    let rest = url.strip_prefix("https://www.youtube.com/").ok_or("host not allowed")?;
    let path = format!("/{rest}");
    let mut headers = String::from("Accept-Language: uk-UA,uk;q=0.9,en;q=0.8\r\nCookie: SOCS=CAI; CONSENT=YES+cb\r\n");
    if method == "POST" {
        headers.push_str("Content-Type: application/json\r\n");
    }
    request(if method == "POST" { "POST" } else { "GET" }, "www.youtube.com", &path, &headers, body)
}

/// Font families installed in Windows, sorted, as a JSON array (vertical "@" faces left out).
fn system_fonts() -> String {
    unsafe extern "system" fn each(lf: *const LOGFONTW, _: *const TEXTMETRICW, _: u32, lp: LPARAM) -> i32 {
        let (v, name) = unsafe { (&mut *(lp.0 as *mut Vec<String>), &(*lf).lfFaceName) };
        let s = String::from_utf16_lossy(&name[..name.iter().position(|&c| c == 0).unwrap_or(name.len())]);
        if !s.is_empty() && !s.starts_with('@') {
            v.push(s);
        }
        1
    }
    let mut v: Vec<String> = Vec::new();
    unsafe {
        let dc = GetDC(None);
        let lf = LOGFONTW { lfCharSet: DEFAULT_CHARSET, ..Default::default() };
        EnumFontFamiliesExW(dc, &lf, Some(each), LPARAM(&mut v as *mut Vec<String> as isize), 0);
        ReleaseDC(None, dc);
    }
    v.sort_by_key(|s| s.to_lowercase());
    v.dedup();
    format!("[{}]", v.iter().map(|s| format!("\"{}\"", s.replace(['"', '\\'], ""))).collect::<Vec<_>>().join(","))
}

/// The latest GitHub release against this build: {"status": "new" | "latest" | "none" | "error", "latest": "x.y.z"}.
fn update_check() -> String {
    let res = request("GET", "api.github.com", "/repos/Fenderenko/FoldbackChat/releases/latest", "Accept: application/vnd.github+json\r\n", b"");
    let (status, latest) = match res {
        Ok((404, _)) => ("none", String::new()),
        Ok((200, b)) => {
            let body = String::from_utf8_lossy(&b);
            let tag = body.split("\"tag_name\"").nth(1).and_then(|r| r.split('"').nth(1)).unwrap_or("").trim_start_matches('v').to_string();
            let ver = |s: &str| s.split(['.', '-']).take(3).map(|x| x.parse::<u32>().unwrap_or(0)).collect::<Vec<_>>();
            if tag.is_empty() {
                ("error", tag)
            } else if ver(&tag) > ver(env!("CARGO_PKG_VERSION")) {
                ("new", tag)
            } else {
                ("latest", tag)
            }
        }
        _ => ("error", String::new()),
    };
    format!("{{\"status\":\"{status}\",\"latest\":\"{}\"}}", latest.replace(['"', '\\'], ""))
}

/// A WinHTTP handle, closed when dropped.
struct Handle(*mut c_void);

impl Drop for Handle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            let _ = unsafe { WinHttpCloseHandle(self.0) };
        }
    }
}

/// (any thread; blocks) One HTTPS request; status and body (at most 8 MB).
pub fn request(method: &str, host: &str, path: &str, headers: &str, body: &[u8]) -> Result<(u16, Vec<u8>), String> {
    unsafe {
        let agent = HSTRING::from("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36");
        let ses = Handle(WinHttpOpen(&agent, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, PCWSTR::null(), PCWSTR::null(), 0));
        if ses.0.is_null() {
            return Err("WinHttpOpen".into());
        }
        let _ = WinHttpSetTimeouts(ses.0, 5000, 5000, 8000, 10000);
        let con = Handle(WinHttpConnect(ses.0, &HSTRING::from(host), INTERNET_DEFAULT_HTTPS_PORT, 0));
        if con.0.is_null() {
            return Err("WinHttpConnect".into());
        }
        let req = Handle(WinHttpOpenRequest(con.0, &HSTRING::from(method), &HSTRING::from(path), PCWSTR::null(), PCWSTR::null(), std::ptr::null(), WINHTTP_FLAG_SECURE));
        if req.0.is_null() {
            return Err("WinHttpOpenRequest".into());
        }
        let h: Vec<u16> = headers.encode_utf16().collect();
        let (ptr, n) = if body.is_empty() { (None, 0) } else { (Some(body.as_ptr() as *const c_void), body.len() as u32) };
        WinHttpSendRequest(req.0, Some(&h), ptr, n, n, 0).and_then(|_| WinHttpReceiveResponse(req.0, std::ptr::null_mut())).map_err(|e| e.to_string())?;
        let (mut code, mut len) = (0u32, 4u32);
        let _ = WinHttpQueryHeaders(req.0, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, PCWSTR::null(), Some(&mut code as *mut u32 as *mut c_void), &mut len, std::ptr::null_mut());
        let mut out = Vec::new();
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let mut got = 0u32;
            WinHttpReadData(req.0, buf.as_mut_ptr() as *mut c_void, buf.len() as u32, &mut got).map_err(|e| e.to_string())?;
            if got == 0 {
                break;
            }
            out.extend_from_slice(&buf[..got as usize]);
            if out.len() > 8 << 20 {
                return Err("too large".into());
            }
        }
        Ok((code as u16, out))
    }
}
