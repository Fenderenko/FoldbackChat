//! Local API for other apps (the OBS dock, Streamer.bot, Stream Deck plugins): every chat message and event of
//! both platforms as JSON over SSE (/api/events) and WebSocket (/api/ws), the recent messages (/api/recent) and
//! the featured message that the /obs?featured source shows. The in-app overlay page is the only producer
//! (/api/push). The format is described in docs/API.md.

use std::{
    collections::VecDeque,
    io::{Read, Write},
    net::TcpStream,
    sync::Mutex,
};

use crate::net::param;

/// How many messages /api/recent keeps.
const RECENT: usize = 100;

static SSE: Mutex<Vec<TcpStream>> = Mutex::new(Vec::new());
static WS: Mutex<Vec<TcpStream>> = Mutex::new(Vec::new());
/// Recent messages, oldest first: (id, login in lower case, JSON).
static MSGS: Mutex<VecDeque<(String, String, String)>> = Mutex::new(VecDeque::new());
/// The featured message: (id, JSON); empty JSON — none.
static FEATURED: Mutex<(String, String)> = Mutex::new((String::new(), String::new()));

/// One event to every SSE and WebSocket client; a write error drops the client.
pub fn broadcast(json: &str) {
    let line = json.replace(['\r', '\n'], " ");
    let sse = format!("data: {line}\n\n");
    SSE.lock().unwrap().retain_mut(|s| s.write_all(sse.as_bytes()).and_then(|_| s.flush()).is_ok());
    let frame = ws_frame(0x1, line.as_bytes());
    WS.lock().unwrap().retain_mut(|s| s.write_all(&frame).is_ok());
}

/// Keep-alive, so dead clients are found and dropped.
pub fn ping() {
    SSE.lock().unwrap().retain_mut(|s| s.write_all(b": ping\n\n").and_then(|_| s.flush()).is_ok());
    let frame = ws_frame(0x9, b"");
    WS.lock().unwrap().retain_mut(|s| s.write_all(&frame).is_ok());
}

/// From the overlay page: "?id=&login=" — a message (kept for /api/recent), "?del=id" — a deleted message,
/// "?clear=login" — a viewer's messages removed ("?clear=" — all); the body goes out to the clients as it is.
pub fn push(query: &str, body: &[u8]) {
    let json = String::from_utf8_lossy(body).into_owned();
    {
        let mut m = MSGS.lock().unwrap();
        if let Some(id) = param(query, "id") {
            m.push_back((id, param(query, "login").unwrap_or_default().to_lowercase(), json.clone()));
            while m.len() > RECENT {
                m.pop_front();
            }
        }
        if let Some(id) = param(query, "del") {
            m.retain(|x| x.0 != id);
        }
        if let Some(login) = param(query, "clear") {
            let login = login.to_lowercase();
            m.retain(|x| !login.is_empty() && x.1 != login);
        }
    }
    broadcast(&json);
}

pub fn recent() -> String {
    let m = MSGS.lock().unwrap();
    format!("[{}]", m.iter().map(|x| x.2.as_str()).collect::<Vec<_>>().join(","))
}

pub fn featured() -> String {
    let f = FEATURED.lock().unwrap();
    format!("{{\"type\":\"featured\",\"message\":{}}}", if f.1.is_empty() { "null" } else { &f.1 })
}

/// Features a recent message by id, the newest one ("last"), or a message of another app (its JSON as the body).
pub fn feature(id: &str, body: &[u8]) -> bool {
    let item = if !body.is_empty() {
        let json = String::from_utf8_lossy(body).into_owned();
        Some((json_str(&json, "id").unwrap_or_else(|| "external".into()), json))
    } else {
        let m = MSGS.lock().unwrap();
        if id == "last" { m.back() } else { m.iter().rev().find(|x| x.0 == id) }.map(|x| (x.0.clone(), x.2.clone()))
    };
    let Some(item) = item else { return false };
    *FEATURED.lock().unwrap() = item;
    broadcast(&featured());
    true
}

/// Takes the featured message off; with an id, only if that one is still featured (a source's timer ran out).
pub fn unfeature(id: &str) {
    {
        let mut f = FEATURED.lock().unwrap();
        if f.1.is_empty() || (!id.is_empty() && f.0 != id) {
            return;
        }
        *f = (String::new(), String::new());
    }
    broadcast(&featured());
}

/// An SSE client: the featured state first, then every event.
pub fn sse(mut s: TcpStream) -> std::io::Result<()> {
    s.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: keep-alive\r\n\r\n")?;
    s.write_all(format!("data: {}\n\n", featured()).as_bytes())?;
    s.flush()?;
    SSE.lock().unwrap().push(s);
    Ok(())
}

/// A WebSocket client (RFC 6455): the featured state first, then every event. Text frames from it are commands;
/// they are ignored when `trusted` is false (a web page from another site).
pub fn websocket(mut s: TcpStream, key: &str, trusted: bool) -> std::io::Result<()> {
    let accept = base64(&sha1(format!("{key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11").as_bytes()));
    s.write_all(format!("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n").as_bytes())?;
    s.write_all(&ws_frame(0x1, featured().as_bytes()))?;
    WS.lock().unwrap().push(s.try_clone()?);
    loop {
        let (op, data) = read_frame(&mut s)?;
        match op {
            0x8 => {
                // The list lock keeps this write apart from a broadcast on the same socket.
                let _g = WS.lock().unwrap();
                let _ = s.write_all(&ws_frame(0x8, b""));
                return Ok(());
            }
            0x9 => {
                let _g = WS.lock().unwrap();
                s.write_all(&ws_frame(0xA, &data))?;
            }
            0x1 if trusted => command(&String::from_utf8_lossy(&data)),
            _ => {}
        }
    }
}

/// {"cmd":"feature","id":"..."}, {"cmd":"feature","id":"last"}, {"cmd":"unfeature"}.
fn command(text: &str) {
    match json_str(text, "cmd").as_deref() {
        Some("feature") => {
            feature(&json_str(text, "id").unwrap_or_else(|| "last".into()), b"");
        }
        Some("unfeature") => unfeature(""),
        _ => {}
    }
}

fn read_frame(s: &mut TcpStream) -> std::io::Result<(u8, Vec<u8>)> {
    let mut h = [0u8; 2];
    s.read_exact(&mut h)?;
    let mut len = (h[1] & 0x7f) as u64;
    if len == 126 {
        let mut b = [0u8; 2];
        s.read_exact(&mut b)?;
        len = u16::from_be_bytes(b) as u64;
    } else if len == 127 {
        let mut b = [0u8; 8];
        s.read_exact(&mut b)?;
        len = u64::from_be_bytes(b);
    }
    if len > 1 << 16 {
        return Err(std::io::Error::other("frame too large"));
    }
    let mut mask = [0u8; 4];
    if h[1] & 0x80 != 0 {
        s.read_exact(&mut mask)?;
    }
    let mut data = vec![0u8; len as usize];
    s.read_exact(&mut data)?;
    for (i, b) in data.iter_mut().enumerate() {
        *b ^= mask[i % 4];
    }
    Ok((h[0] & 0x0f, data))
}

/// A single unmasked frame (server to client).
fn ws_frame(op: u8, data: &[u8]) -> Vec<u8> {
    let mut f = vec![0x80 | op];
    match data.len() {
        n if n < 126 => f.push(n as u8),
        n if n < 1 << 16 => {
            f.push(126);
            f.extend_from_slice(&(n as u16).to_be_bytes());
        }
        n => {
            f.push(127);
            f.extend_from_slice(&(n as u64).to_be_bytes());
        }
    }
    f.extend_from_slice(data);
    f
}

/// A string field of a small flat JSON object; \" and \\ are unescaped, other escapes are kept as they are.
fn json_str(j: &str, key: &str) -> Option<String> {
    let at = j.find(&format!("\"{key}\""))? + key.len() + 2;
    let rest = j[at..].trim_start().strip_prefix(':')?.trim_start().strip_prefix('"')?;
    let (mut out, mut esc) = (String::new(), false);
    for ch in rest.chars() {
        match (esc, ch) {
            (true, _) => {
                out.push(ch);
                esc = false;
            }
            (false, '\\') => esc = true,
            (false, '"') => return Some(out),
            _ => out.push(ch),
        }
    }
    None
}

/// SHA-1, only for the WebSocket handshake.
fn sha1(data: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [0x6745_2301, 0xEFCD_AB89, 0x98BA_DCFE, 0x1032_5476, 0xC3D2_E1F0];
    let mut m = data.to_vec();
    m.push(0x80);
    while m.len() % 64 != 56 {
        m.push(0);
    }
    m.extend_from_slice(&((data.len() as u64) * 8).to_be_bytes());
    for c in m.chunks(64) {
        let mut w = [0u32; 80];
        for (i, x) in c.chunks(4).enumerate() {
            w[i] = u32::from_be_bytes([x[0], x[1], x[2], x[3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let [mut a, mut b, mut c2, mut d, mut e] = h;
        for (i, &wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c2) | (!b & d), 0x5A82_7999),
                20..=39 => (b ^ c2 ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c2) | (b & d) | (c2 & d), 0x8F1B_BCDC),
                _ => (b ^ c2 ^ d, 0xCA62_C1D6),
            };
            let t = a.rotate_left(5).wrapping_add(f).wrapping_add(e).wrapping_add(k).wrapping_add(wi);
            (e, d, c2, b, a) = (d, c2, b.rotate_left(30), a, t);
        }
        for (x, v) in h.iter_mut().zip([a, b, c2, d, e]) {
            *x = x.wrapping_add(v);
        }
    }
    let mut out = [0u8; 20];
    for (i, v) in h.iter().enumerate() {
        out[4 * i..4 * i + 4].copy_from_slice(&v.to_be_bytes());
    }
    out
}

fn base64(b: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::new();
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            s.push(if i <= c.len() { A[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handshake_accept() {
        // The example of RFC 6455, section 1.3.
        let k = format!("{}258EAFA5-E914-47DA-95CA-C5AB0DC85B11", "dGhlIHNhbXBsZSBub25jZQ==");
        assert_eq!(base64(&sha1(k.as_bytes())), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    }

    #[test]
    fn command_fields() {
        assert_eq!(json_str(r#"{"cmd": "feature", "id":"a\"b"}"#, "id").as_deref(), Some("a\"b"));
        assert_eq!(json_str(r#"{"cmd":"unfeature"}"#, "id"), None);
    }
}
