//! Raw C-ABI exports for WebAssembly (no wasm-bindgen). Also compiled natively (harmless).
//!
//! Memory protocol (see web/vrcore.js):
//!   1. JS calls `vr_alloc(len)` for each input buffer and copies bytes into `memory` at the pointer.
//!   2. JS calls `vr_compare(a_ptr, a_len, b_ptr, b_len, opt_ptr, opt_len, render)`; Rust frees the
//!      three input buffers itself (ownership moves into Rust) and stores the result internally.
//!   3. JS reads `vr_out_json_ptr/len` (UTF-8 JSON) and `vr_out_png_ptr/len` (diff PNG bytes),
//!      copying them out before the next call; `vr_out_clear()` releases them.
//! Return value of vr_compare: 0 = ok, 1 = error (JSON then has {"ok":false,"error":...}).

use crate::{error_json, run_pngs, VERSION};
use std::cell::RefCell;

thread_local! {
    static OUT: RefCell<(Vec<u8>, Vec<u8>)> = const { RefCell::new((Vec::new(), Vec::new())) };
}

fn layout(len: usize) -> std::alloc::Layout {
    std::alloc::Layout::array::<u8>(len.max(1)).expect("layout")
}

/// Allocate `len` bytes owned by JS until passed back to vr_compare or vr_free.
#[no_mangle]
pub extern "C" fn vr_alloc(len: usize) -> *mut u8 {
    unsafe { std::alloc::alloc(layout(len)) }
}

/// # Safety
/// `p`/`len` must come from `vr_alloc(len)` and not be freed twice.
#[no_mangle]
pub unsafe extern "C" fn vr_free(p: *mut u8, len: usize) {
    if !p.is_null() {
        std::alloc::dealloc(p, layout(len));
    }
}

/// Copy a vr_alloc'd buffer into a Vec and release the original.
unsafe fn take(p: *mut u8, len: usize) -> Vec<u8> {
    if p.is_null() {
        return Vec::new();
    }
    let v = std::slice::from_raw_parts(p, len).to_vec();
    vr_free(p, len);
    v
}

/// # Safety
/// All pointers must come from `vr_alloc` with the given lengths; ownership moves to Rust.
#[no_mangle]
pub unsafe extern "C" fn vr_compare(a: *mut u8, a_len: usize, b: *mut u8, b_len: usize, o: *mut u8, o_len: usize, render: u32) -> u32 {
    let av = take(a, a_len);
    let bv = take(b, b_len);
    let ov = take(o, o_len);
    let opt = String::from_utf8_lossy(&ov).into_owned();
    let (code, json, png) = match run_pngs(&av, &bv, &opt, render != 0) {
        Ok(out) => (0, out.json, out.diff_png),
        Err(e) => (1, error_json(&e), Vec::new()),
    };
    drop((av, bv, ov));
    OUT.with(|c| *c.borrow_mut() = (json.into_bytes(), png));
    code
}

#[no_mangle]
pub extern "C" fn vr_out_json_ptr() -> *const u8 {
    OUT.with(|c| c.borrow().0.as_ptr())
}
#[no_mangle]
pub extern "C" fn vr_out_json_len() -> usize {
    OUT.with(|c| c.borrow().0.len())
}
#[no_mangle]
pub extern "C" fn vr_out_png_ptr() -> *const u8 {
    OUT.with(|c| c.borrow().1.as_ptr())
}
#[no_mangle]
pub extern "C" fn vr_out_png_len() -> usize {
    OUT.with(|c| c.borrow().1.len())
}
#[no_mangle]
pub extern "C" fn vr_out_clear() {
    OUT.with(|c| *c.borrow_mut() = (Vec::new(), Vec::new()));
}

static VERSION_Z: &str = VERSION;
#[no_mangle]
pub extern "C" fn vr_version_ptr() -> *const u8 {
    VERSION_Z.as_ptr()
}
#[no_mangle]
pub extern "C" fn vr_version_len() -> usize {
    VERSION_Z.len()
}
