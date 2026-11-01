//! Windows resources for the exe: the icons (assets/*.png, stored as PNG icon images; made by
//! tools/mkicon.py) and the version info. Written as a .res file that link.exe takes directly, so no
//! resource compiler is needed.

use std::{env, fs, path::PathBuf};

const RT_ICON: u16 = 3;
const RT_GROUP_ICON: u16 = 14;
const RT_VERSION: u16 = 16;
const LANG_EN: u16 = 0x0409;
const TRAY: [u32; 6] = [16, 20, 24, 32, 40, 48];
/// Icon groups: resource id, file prefix, sizes. 1 — the app, 2 / 3 — tray for a dark / light taskbar.
const GROUPS: [(u16, &str, &[u32]); 3] = [(1, "icon", &[16, 24, 32, 48, 256]), (2, "tray-light", &TRAY), (3, "tray-dark", &TRAY)];

fn main() {
    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=assets");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let ver = env::var("CARGO_PKG_VERSION").unwrap();

    let mut res = Vec::new();
    res.extend(entry(0, 0, 0, &[])); // a .res file starts with an empty entry
    let mut next = 1u16;
    for (gid, prefix, sizes) in GROUPS {
        let mut icons = Vec::new();
        for &s in sizes {
            let data = fs::read(root.join("assets").join(format!("{prefix}{s}.png"))).expect("assets/*.png: run tools/mkicon.py");
            res.extend(entry(RT_ICON, next, 0, &data));
            icons.push((s, data.len(), next));
            next += 1;
        }
        res.extend(entry(RT_GROUP_ICON, gid, 0, &group_icon(&icons)));
    }
    res.extend(entry(RT_VERSION, 1, LANG_EN, &version_info(&ver)));

    let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("app.res");
    fs::write(&out, res).unwrap();
    println!("cargo:rustc-link-arg-bins={}", out.display());
}

/// GRPICONDIR: size, data length and RT_ICON id of each image.
fn group_icon(icons: &[(u32, usize, u16)]) -> Vec<u8> {
    let mut b = Vec::new();
    for v in [0u16, 1, icons.len() as u16] {
        b.extend(v.to_le_bytes());
    }
    for &(s, len, id) in icons {
        let d = if s >= 256 { 0 } else { s as u8 }; // 0 means 256
        b.extend([d, d, 0, 0]);
        b.extend(1u16.to_le_bytes());
        b.extend(32u16.to_le_bytes());
        b.extend((len as u32).to_le_bytes());
        b.extend(id.to_le_bytes());
    }
    b
}

fn pad4(b: &mut Vec<u8>) {
    while b.len() % 4 != 0 {
        b.push(0);
    }
}

/// One resource of a .res file: header (type and name by number) and data, both DWORD aligned.
fn entry(typ: u16, id: u16, lang: u16, data: &[u8]) -> Vec<u8> {
    let mut hdr = Vec::new();
    hdr.extend((data.len() as u32).to_le_bytes());
    hdr.extend(32u32.to_le_bytes());
    hdr.extend([0xFF, 0xFF]);
    hdr.extend(typ.to_le_bytes());
    hdr.extend([0xFF, 0xFF]);
    hdr.extend(id.to_le_bytes());
    hdr.extend(0u32.to_le_bytes());
    let flags: u16 = if typ == 0 { 0 } else { 0x1030 };
    hdr.extend(flags.to_le_bytes());
    hdr.extend(lang.to_le_bytes());
    hdr.extend(0u32.to_le_bytes());
    hdr.extend(0u32.to_le_bytes());
    hdr.extend(data);
    pad4(&mut hdr);
    hdr
}

fn utf16z(s: &str) -> Vec<u8> {
    s.encode_utf16().chain([0]).flat_map(|c| c.to_le_bytes()).collect()
}

/// VS_VERSIONINFO node: wLength, wValueLength, wType, szKey, padding, value, padding, children.
fn ver_node(key: &str, value: &[u8], text: bool, value_len: Option<u16>, children: &[Vec<u8>]) -> Vec<u8> {
    let mut b = vec![0, 0, 0, 0];
    b.extend((text as u16).to_le_bytes());
    b.extend(utf16z(key));
    pad4(&mut b);
    b.extend(value);
    for c in children {
        pad4(&mut b);
        b.extend(c);
    }
    let len = b.len() as u16;
    let vl = value_len.unwrap_or(value.len() as u16);
    b[0..2].copy_from_slice(&len.to_le_bytes());
    b[2..4].copy_from_slice(&vl.to_le_bytes());
    b
}

fn version_info(ver: &str) -> Vec<u8> {
    let mut nums: Vec<u32> = ver.split('.').filter_map(|x| x.parse().ok()).take(4).collect();
    nums.resize(4, 0);
    let (ms, ls) = ((nums[0] << 16) | nums[1], (nums[2] << 16) | nums[3]);
    let mut fixed = Vec::new();
    for v in [0xFEEF04BDu32, 0x00010000, ms, ls, ms, ls, 0x3F, 0, 0x40004, 1, 0, 0, 0] {
        fixed.extend(v.to_le_bytes());
    }
    let strings = [
        ("CompanyName", "fndr7x"),
        ("FileDescription", "Foldback Chat"),
        ("FileVersion", ver),
        ("InternalName", "FoldbackChat"),
        ("OriginalFilename", "FoldbackChat.exe"),
        ("ProductName", "Foldback Chat"),
        ("ProductVersion", ver),
    ];
    let nodes: Vec<Vec<u8>> = strings.iter().map(|(k, v)| ver_node(k, &utf16z(v), true, Some(v.encode_utf16().count() as u16 + 1), &[])).collect();
    let table = ver_node("040904B0", &[], true, None, &nodes);
    let sfi = ver_node("StringFileInfo", &[], true, None, &[table]);
    let mut tr = Vec::new();
    tr.extend(LANG_EN.to_le_bytes());
    tr.extend(0x04B0u16.to_le_bytes());
    let var = ver_node("Translation", &tr, false, None, &[]);
    let vfi = ver_node("VarFileInfo", &[], true, None, &[var]);
    ver_node("VS_VERSION_INFO", &fixed, false, None, &[sfi, vfi])
}
