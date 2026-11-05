//! vr-core: visual regression image-diff core.
//!
//! Pipeline: decode PNG -> pad to common size -> per-pixel YIQ delta (pixelmatch-like,
//! anti-aliasing aware) -> ignore regions -> grid-merge clustering into bounding boxes ->
//! render diff image (faded context + semi-transparent red overlay + red boxes) -> encode PNG.
//!
//! The same code is compiled natively (`vr-native` binary) and to `wasm32-unknown-unknown`
//! (see `wasm.rs`, raw `extern "C"` exports, no wasm-bindgen).

pub mod wasm;

use std::fmt::Write as _;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
/// Upper bound on pixels per image (protects wasm memory): 50 megapixels.
pub const MAX_PIXELS: u64 = 50_000_000;

/// RGBA8 image.
#[derive(Clone, Debug, PartialEq)]
pub struct Image {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

impl Image {
    pub fn new(width: u32, height: u32, fill: [u8; 4]) -> Image {
        let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
        for _ in 0..(width as usize * height as usize) {
            rgba.extend_from_slice(&fill);
        }
        Image { width, height, rgba }
    }

    pub fn fill_rect(&mut self, r: Rect, c: [u8; 4]) {
        let x1 = (r.x + r.w).min(self.width);
        let y1 = (r.y + r.h).min(self.height);
        for y in r.y.min(self.height)..y1 {
            for x in r.x.min(self.width)..x1 {
                let i = (y as usize * self.width as usize + x as usize) * 4;
                self.rgba[i..i + 4].copy_from_slice(&c);
            }
        }
    }

    /// Copy into a larger transparent canvas (used when sizes differ).
    fn padded(&self, w: u32, h: u32) -> Image {
        if w == self.width && h == self.height {
            return self.clone();
        }
        let mut out = Image::new(w, h, [0, 0, 0, 0]);
        for y in 0..self.height as usize {
            let src = &self.rgba[y * self.width as usize * 4..(y + 1) * self.width as usize * 4];
            let d = y * w as usize * 4;
            out.rgba[d..d + src.len()].copy_from_slice(src);
        }
        out
    }
}

/// Axis-aligned rectangle in pixel coordinates.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

impl Rect {
    pub fn contains(&self, x: u32, y: u32) -> bool {
        x >= self.x && y >= self.y && x < self.x.saturating_add(self.w) && y < self.y.saturating_add(self.h)
    }
    pub fn intersects(&self, o: &Rect) -> bool {
        self.x < o.x + o.w && o.x < self.x + self.w && self.y < o.y + o.h && o.y < self.y + self.h
    }
}

/// A cluster of changed pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DiffBox {
    pub rect: Rect,
    pub pixels: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Options {
    /// 0..1, pixelmatch semantics (0.1 default). Smaller = more sensitive.
    pub threshold: f64,
    /// If true, anti-aliased pixels are counted as differences.
    pub include_aa: bool,
    /// Rectangles excluded from comparison.
    pub ignore: Vec<Rect>,
    /// Grid cell size used to merge nearby diff pixels into one box (0 = strict 8-connectivity).
    pub gap: u32,
    /// Boxes with fewer changed pixels are dropped from `boxes` (still counted in stats).
    pub min_pixels: u32,
    /// Opacity of the faded context image in the diff output (0..1).
    pub fade: f64,
    /// Opacity of the red overlay on changed pixels (0..1).
    pub overlay: f64,
}

impl Default for Options {
    fn default() -> Self {
        Options { threshold: 0.1, include_aa: false, ignore: Vec::new(), gap: 8, min_pixels: 1, fade: 0.3, overlay: 0.7 }
    }
}

impl Options {
    /// Parse the boundary format shared by the native CLI and JS:
    /// `threshold=0.1;aa=0;gap=8;minPixels=1;fade=0.3;overlay=0.7;ignore=x,y,w,h|x,y,w,h`
    pub fn parse(s: &str) -> Result<Options, String> {
        let mut o = Options::default();
        for part in s.split(';').map(str::trim).filter(|p| !p.is_empty()) {
            let (k, v) = part.split_once('=').ok_or_else(|| format!("bad option '{part}'"))?;
            let v = v.trim();
            match k.trim() {
                "threshold" => o.threshold = parse_unit(v, "threshold")?,
                "aa" | "includeAA" => o.include_aa = matches!(v, "1" | "true" | "yes"),
                "gap" => o.gap = v.parse().map_err(|_| format!("bad gap '{v}'"))?,
                "minPixels" => o.min_pixels = v.parse().map_err(|_| format!("bad minPixels '{v}'"))?,
                "fade" => o.fade = parse_unit(v, "fade")?,
                "overlay" => o.overlay = parse_unit(v, "overlay")?,
                "ignore" => {
                    for r in v.split('|').map(str::trim).filter(|r| !r.is_empty()) {
                        o.ignore.push(parse_rect(r)?);
                    }
                }
                other => return Err(format!("unknown option '{other}'")),
            }
        }
        Ok(o)
    }

    pub fn to_option_string(&self) -> String {
        let ig: Vec<String> = self.ignore.iter().map(|r| format!("{},{},{},{}", r.x, r.y, r.w, r.h)).collect();
        format!(
            "threshold={};aa={};gap={};minPixels={};fade={};overlay={};ignore={}",
            self.threshold, self.include_aa as u8, self.gap, self.min_pixels, self.fade, self.overlay, ig.join("|")
        )
    }
}

fn parse_unit(v: &str, name: &str) -> Result<f64, String> {
    let f: f64 = v.parse().map_err(|_| format!("bad {name} '{v}'"))?;
    if !(0.0..=1.0).contains(&f) {
        return Err(format!("{name} must be within 0..1, got {f}"));
    }
    Ok(f)
}

pub fn parse_rect(s: &str) -> Result<Rect, String> {
    let n: Vec<u32> = s.split(',').map(|t| t.trim().parse::<u32>()).collect::<Result<_, _>>().map_err(|_| format!("bad rect '{s}' (expected x,y,w,h)"))?;
    if n.len() != 4 {
        return Err(format!("bad rect '{s}' (expected x,y,w,h)"));
    }
    Ok(Rect { x: n[0], y: n[1], w: n[2], h: n[3] })
}

#[derive(Clone, Debug, PartialEq)]
pub struct DiffResult {
    pub width: u32,
    pub height: u32,
    pub size_a: (u32, u32),
    pub size_b: (u32, u32),
    pub diff_pixels: u64,
    pub aa_pixels: u64,
    pub ignored_pixels: u64,
    pub total_pixels: u64,
    pub boxes: Vec<DiffBox>,
    /// Per pixel: 0 same, 1 diff, 2 anti-aliased, 3 ignored.
    pub mask: Vec<u8>,
}

impl DiffResult {
    pub fn size_mismatch(&self) -> bool {
        self.size_a != self.size_b
    }
    /// Percentage of compared (non-ignored) pixels that changed.
    pub fn percent(&self) -> f64 {
        let compared = self.total_pixels - self.ignored_pixels;
        if compared == 0 {
            0.0
        } else {
            (self.diff_pixels as f64 * 100.0 / compared as f64 * 1000.0).round() / 1000.0
        }
    }
    pub fn to_json(&self, extra: &str) -> String {
        let mut s = String::with_capacity(256 + self.boxes.len() * 48);
        let _ = write!(
            s,
            "{{\"ok\":true,\"version\":\"{}\",\"width\":{},\"height\":{},\"sizeA\":[{},{}],\"sizeB\":[{},{}],\"sizeMismatch\":{},\"totalPixels\":{},\"diffPixels\":{},\"aaPixels\":{},\"ignoredPixels\":{},\"percent\":{},\"boxes\":[",
            VERSION, self.width, self.height, self.size_a.0, self.size_a.1, self.size_b.0, self.size_b.1,
            self.size_mismatch(), self.total_pixels, self.diff_pixels, self.aa_pixels, self.ignored_pixels, self.percent()
        );
        for (i, b) in self.boxes.iter().enumerate() {
            if i > 0 {
                s.push(',');
            }
            let _ = write!(s, "{{\"x\":{},\"y\":{},\"w\":{},\"h\":{},\"pixels\":{}}}", b.rect.x, b.rect.y, b.rect.w, b.rect.h, b.pixels);
        }
        s.push(']');
        s.push_str(extra);
        s.push('}');
        s
    }
}

pub fn error_json(msg: &str) -> String {
    let esc: String = msg.chars().flat_map(|c| match c {
        '"' => vec!['\\', '"'],
        '\\' => vec!['\\', '\\'],
        c if (c as u32) < 0x20 => vec![' '],
        c => vec![c],
    }).collect();
    format!("{{\"ok\":false,\"version\":\"{VERSION}\",\"error\":\"{esc}\"}}")
}

// ---------------------------------------------------------------- PNG I/O

pub fn decode_png(bytes: &[u8]) -> Result<Image, String> {
    let mut dec = png::Decoder::new(bytes);
    dec.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = dec.read_info().map_err(|e| format!("PNG decode: {e}"))?;
    let (w, h) = { let i = reader.info(); (i.width, i.height) };
    if w as u64 * h as u64 > MAX_PIXELS {
        return Err(format!("image too large: {w}x{h} (max {MAX_PIXELS} pixels)"));
    }
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).map_err(|e| format!("PNG decode: {e}"))?;
    let data = &buf[..info.buffer_size()];
    let n = w as usize * h as usize;
    let mut rgba = Vec::with_capacity(n * 4);
    match info.color_type {
        png::ColorType::Rgba => rgba.extend_from_slice(&data[..n * 4]),
        png::ColorType::Rgb => {
            for p in data[..n * 3].chunks_exact(3) {
                rgba.extend_from_slice(&[p[0], p[1], p[2], 255]);
            }
        }
        png::ColorType::Grayscale => {
            for &g in &data[..n] {
                rgba.extend_from_slice(&[g, g, g, 255]);
            }
        }
        png::ColorType::GrayscaleAlpha => {
            for p in data[..n * 2].chunks_exact(2) {
                rgba.extend_from_slice(&[p[0], p[0], p[0], p[1]]);
            }
        }
        png::ColorType::Indexed => return Err("PNG decode: indexed color not expanded".into()),
    }
    // Rows may be padded when width*channels is not the line size; png gives tightly packed rows for 8-bit.
    Ok(Image { width: w, height: h, rgba })
}

pub fn encode_png(img: &Image) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, img.width, img.height);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_compression(png::Compression::Fast);
        let mut w = enc.write_header().map_err(|e| format!("PNG encode: {e}"))?;
        w.write_image_data(&img.rgba).map_err(|e| format!("PNG encode: {e}"))?;
        w.finish().map_err(|e| format!("PNG encode: {e}"))?;
    }
    Ok(out)
}

// ---------------------------------------------------------------- color math (pixelmatch-compatible)

#[inline]
fn blend(c: f64, a: f64) -> f64 {
    255.0 + (c - 255.0) * a
}
#[inline]
fn rgb2y(r: f64, g: f64, b: f64) -> f64 {
    r * 0.29889531 + g * 0.58662247 + b * 0.11448223
}
#[inline]
fn rgb2i(r: f64, g: f64, b: f64) -> f64 {
    r * 0.59597799 - g * 0.27417610 - b * 0.32180189
}
#[inline]
fn rgb2q(r: f64, g: f64, b: f64) -> f64 {
    r * 0.21147017 - g * 0.52261711 + b * 0.31114694
}

#[inline]
fn rgb_of(p: &[u8], k: usize) -> (f64, f64, f64) {
    let (mut r, mut g, mut b, a) = (p[k] as f64, p[k + 1] as f64, p[k + 2] as f64, p[k + 3]);
    if a < 255 {
        let a = a as f64 / 255.0;
        r = blend(r, a);
        g = blend(g, a);
        b = blend(b, a);
    }
    (r, g, b)
}

/// Squared YIQ distance (signed: negative when pixel 1 is brighter), or only the Y delta.
#[inline]
pub fn color_delta(p1: &[u8], p2: &[u8], k: usize, m: usize, y_only: bool) -> f64 {
    if p1[k..k + 4] == p2[m..m + 4] {
        return 0.0;
    }
    let (r1, g1, b1) = rgb_of(p1, k);
    let (r2, g2, b2) = rgb_of(p2, m);
    let y1 = rgb2y(r1, g1, b1);
    let y2 = rgb2y(r2, g2, b2);
    let y = y1 - y2;
    if y_only {
        return y;
    }
    let i = rgb2i(r1, g1, b1) - rgb2i(r2, g2, b2);
    let q = rgb2q(r1, g1, b1) - rgb2q(r2, g2, b2);
    let delta = 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q;
    if y1 > y2 { -delta } else { delta }
}

/// Max squared YIQ distance between two colors (black vs white) is 35215.
pub fn max_delta(threshold: f64) -> f64 {
    35215.0 * threshold * threshold
}

fn has_many_siblings(img: &[u8], x1: u32, y1: u32, w: u32, h: u32) -> bool {
    let x0 = x1.saturating_sub(1);
    let y0 = y1.saturating_sub(1);
    let x2 = (x1 + 1).min(w - 1);
    let y2 = (y1 + 1).min(h - 1);
    let pos = (y1 as usize * w as usize + x1 as usize) * 4;
    let mut zeroes = if x1 == x0 || x1 == x2 || y1 == y0 || y1 == y2 { 1 } else { 0 };
    for x in x0..=x2 {
        for y in y0..=y2 {
            if x == x1 && y == y1 {
                continue;
            }
            let pos2 = (y as usize * w as usize + x as usize) * 4;
            if img[pos..pos + 4] == img[pos2..pos2 + 4] {
                zeroes += 1;
            }
            if zeroes > 2 {
                return true;
            }
        }
    }
    false
}

/// pixelmatch's anti-aliasing detector (Vysniauskas 2009): a pixel is AA if it sits on a
/// brightness gradient between a darkest and brightest neighbour that both belong to flat areas.
fn antialiased(img: &[u8], x1: u32, y1: u32, w: u32, h: u32, img2: &[u8]) -> bool {
    let x0 = x1.saturating_sub(1);
    let y0 = y1.saturating_sub(1);
    let x2 = (x1 + 1).min(w - 1);
    let y2 = (y1 + 1).min(h - 1);
    let pos = (y1 as usize * w as usize + x1 as usize) * 4;
    let mut zeroes = if x1 == x0 || x1 == x2 || y1 == y0 || y1 == y2 { 1 } else { 0 };
    let (mut min, mut max) = (0.0f64, 0.0f64);
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (0u32, 0u32, 0u32, 0u32);
    for x in x0..=x2 {
        for y in y0..=y2 {
            if x == x1 && y == y1 {
                continue;
            }
            let d = color_delta(img, img, pos, (y as usize * w as usize + x as usize) * 4, true);
            if d == 0.0 {
                zeroes += 1;
                if zeroes > 2 {
                    return false;
                }
            } else if d < min {
                min = d;
                min_x = x;
                min_y = y;
            } else if d > max {
                max = d;
                max_x = x;
                max_y = y;
            }
        }
    }
    if min == 0.0 || max == 0.0 {
        return false;
    }
    (has_many_siblings(img, min_x, min_y, w, h) && has_many_siblings(img2, min_x, min_y, w, h))
        || (has_many_siblings(img, max_x, max_y, w, h) && has_many_siblings(img2, max_x, max_y, w, h))
}

// ---------------------------------------------------------------- compare

pub const M_SAME: u8 = 0;
pub const M_DIFF: u8 = 1;
pub const M_AA: u8 = 2;
pub const M_IGNORED: u8 = 3;

/// Compare two images. Different sizes are padded (transparent = white after blending).
pub fn compare(a: &Image, b: &Image, opts: &Options) -> DiffResult {
    let w = a.width.max(b.width);
    let h = a.height.max(b.height);
    let pa;
    let pb;
    let (ia, ib) = if a.width == w && a.height == h && b.width == w && b.height == h {
        (a, b)
    } else {
        pa = a.padded(w, h);
        pb = b.padded(w, h);
        (&pa, &pb)
    };
    compare_same_size(ia, ib, opts, (a.width, a.height), (b.width, b.height))
}

fn compare_same_size(a: &Image, b: &Image, opts: &Options, size_a: (u32, u32), size_b: (u32, u32)) -> DiffResult {
    let (w, h) = (a.width, a.height);
    let n = w as usize * h as usize;
    let mut mask = vec![M_SAME; n];
    let maxd = max_delta(opts.threshold);
    let (mut diff, mut aa, mut ign) = (0u64, 0u64, 0u64);
    let ignore: Vec<Rect> = opts.ignore.iter().filter(|r| r.w > 0 && r.h > 0).copied().collect();

    // Fast path: identical buffers and no ignore regions.
    if ignore.is_empty() && a.rgba == b.rgba {
        return DiffResult { width: w, height: h, size_a, size_b, diff_pixels: 0, aa_pixels: 0, ignored_pixels: 0, total_pixels: n as u64, boxes: Vec::new(), mask };
    }
    for y in 0..h {
        let row_ignores: Vec<&Rect> = ignore.iter().filter(|r| y >= r.y && y < r.y.saturating_add(r.h)).collect();
        for x in 0..w {
            let idx = y as usize * w as usize + x as usize;
            if !row_ignores.is_empty() && row_ignores.iter().any(|r| r.contains(x, y)) {
                mask[idx] = M_IGNORED;
                ign += 1;
                continue;
            }
            let k = idx * 4;
            let d = color_delta(&a.rgba, &b.rgba, k, k, false);
            if d.abs() > maxd {
                if !opts.include_aa && (antialiased(&a.rgba, x, y, w, h, &b.rgba) || antialiased(&b.rgba, x, y, w, h, &a.rgba)) {
                    mask[idx] = M_AA;
                    aa += 1;
                } else {
                    mask[idx] = M_DIFF;
                    diff += 1;
                }
            }
        }
    }
    let boxes = cluster(&mask, w, h, opts.gap, opts.min_pixels);
    DiffResult { width: w, height: h, size_a, size_b, diff_pixels: diff, aa_pixels: aa, ignored_pixels: ign, total_pixels: n as u64, boxes, mask }
}

// ---------------------------------------------------------------- clustering

/// Grid-merge clustering: the image is divided into `gap`x`gap` cells; a cell is "hot" if it
/// contains a diff pixel; hot cells are joined by 8-connectivity (union-find), so pixels closer
/// than roughly one cell end up in the same cluster. Each cluster's tight pixel bounding box is
/// then computed, and overlapping boxes are merged until stable. O(pixels + cells).
pub fn cluster(mask: &[u8], w: u32, h: u32, gap: u32, min_pixels: u32) -> Vec<DiffBox> {
    let cs = gap.max(1) as usize;
    let (w, h) = (w as usize, h as usize);
    let gw = w.div_ceil(cs);
    let gh = h.div_ceil(cs);
    let mut hot = vec![false; gw * gh];
    let mut any = false;
    for y in 0..h {
        let row = &mask[y * w..(y + 1) * w];
        for (x, &m) in row.iter().enumerate() {
            if m == M_DIFF {
                hot[(y / cs) * gw + x / cs] = true;
                any = true;
            }
        }
    }
    if !any {
        return Vec::new();
    }
    // union-find over cells
    let mut parent: Vec<u32> = (0..(gw * gh) as u32).collect();
    fn find(p: &mut [u32], mut i: u32) -> u32 {
        while p[i as usize] != i {
            p[i as usize] = p[p[i as usize] as usize];
            i = p[i as usize];
        }
        i
    }
    fn union(p: &mut [u32], a: u32, b: u32) {
        let (ra, rb) = (find(p, a), find(p, b));
        if ra != rb {
            let (lo, hi) = if ra < rb { (ra, rb) } else { (rb, ra) };
            p[hi as usize] = lo;
        }
    }
    for cy in 0..gh {
        for cx in 0..gw {
            let i = cy * gw + cx;
            if !hot[i] {
                continue;
            }
            // previous neighbours: left, up-left, up, up-right
            if cx > 0 && hot[i - 1] {
                union(&mut parent, i as u32, (i - 1) as u32);
            }
            if cy > 0 {
                for dx in [-1i64, 0, 1] {
                    let nx = cx as i64 + dx;
                    if nx >= 0 && (nx as usize) < gw {
                        let j = (cy - 1) * gw + nx as usize;
                        if hot[j] {
                            union(&mut parent, i as u32, j as u32);
                        }
                    }
                }
            }
        }
    }
    // bounding boxes per root, in pixel space
    let mut slot = vec![u32::MAX; gw * gh];
    let mut acc: Vec<[u64; 5]> = Vec::new(); // minx, miny, maxx, maxy, count
    for y in 0..h {
        for x in 0..w {
            if mask[y * w + x] != M_DIFF {
                continue;
            }
            let root = find(&mut parent, ((y / cs) * gw + x / cs) as u32) as usize;
            if slot[root] == u32::MAX {
                slot[root] = acc.len() as u32;
                acc.push([x as u64, y as u64, x as u64, y as u64, 0]);
            }
            let a = &mut acc[slot[root] as usize];
            a[0] = a[0].min(x as u64);
            a[1] = a[1].min(y as u64);
            a[2] = a[2].max(x as u64);
            a[3] = a[3].max(y as u64);
            a[4] += 1;
        }
    }
    let mut boxes: Vec<DiffBox> = acc
        .iter()
        .map(|a| DiffBox { rect: Rect { x: a[0] as u32, y: a[1] as u32, w: (a[2] - a[0] + 1) as u32, h: (a[3] - a[1] + 1) as u32 }, pixels: a[4] as u32 })
        .collect();
    // merge overlapping boxes until stable
    loop {
        let mut merged = false;
        let mut i = 0;
        while i < boxes.len() {
            let mut j = i + 1;
            while j < boxes.len() {
                if boxes[i].rect.intersects(&boxes[j].rect) {
                    let (a, b) = (boxes[i], boxes.swap_remove(j));
                    let x0 = a.rect.x.min(b.rect.x);
                    let y0 = a.rect.y.min(b.rect.y);
                    let x1 = (a.rect.x + a.rect.w).max(b.rect.x + b.rect.w);
                    let y1 = (a.rect.y + a.rect.h).max(b.rect.y + b.rect.h);
                    boxes[i] = DiffBox { rect: Rect { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, pixels: a.pixels + b.pixels };
                    merged = true;
                } else {
                    j += 1;
                }
            }
            i += 1;
        }
        if !merged {
            break;
        }
    }
    boxes.retain(|b| b.pixels >= min_pixels.max(1));
    boxes.sort_by_key(|b| (b.rect.y, b.rect.x));
    boxes
}

// ---------------------------------------------------------------- rendering

const RED: [u8; 3] = [230, 20, 30];
const YELLOW: [u8; 3] = [255, 196, 0];
const BLUE: [u8; 3] = [40, 120, 255];

#[inline]
fn mix(c: u8, t: u8, a: f64) -> u8 {
    (c as f64 + (t as f64 - c as f64) * a).round().clamp(0.0, 255.0) as u8
}

/// Render the diff image from the *current* image `b`:
/// unchanged pixels = faded grayscale context, changed = red semi-transparent overlay over the
/// real color, anti-aliased = light yellow, ignored = blue tint, plus 2px red box outlines.
pub fn render_diff(b: &Image, res: &DiffResult, opts: &Options) -> Image {
    let (w, h) = (res.width, res.height);
    let bp = if b.width == w && b.height == h { None } else { Some(b.padded(w, h)) };
    let src = bp.as_ref().unwrap_or(b);
    let mut out = vec![0u8; w as usize * h as usize * 4];
    for (i, m) in res.mask.iter().enumerate() {
        let k = i * 4;
        let (r, g, bl) = rgb_of(&src.rgba, k);
        let (r, g, bl) = (r as u8, g as u8, bl as u8);
        let px: [u8; 3] = match *m {
            M_DIFF => [mix(r, RED[0], opts.overlay), mix(g, RED[1], opts.overlay), mix(bl, RED[2], opts.overlay)],
            _ => {
                let y = rgb2y(r as f64, g as f64, bl as f64);
                let v = blend(y, opts.fade).round().clamp(0.0, 255.0) as u8;
                match *m {
                    M_AA => [mix(v, YELLOW[0], 0.5), mix(v, YELLOW[1], 0.5), mix(v, YELLOW[2], 0.5)],
                    M_IGNORED => [mix(v, BLUE[0], 0.25), mix(v, BLUE[1], 0.25), mix(v, BLUE[2], 0.25)],
                    _ => [v, v, v],
                }
            }
        };
        out[k..k + 3].copy_from_slice(&px);
        out[k + 3] = 255;
    }
    let mut img = Image { width: w, height: h, rgba: out };
    for bx in &res.boxes {
        draw_box(&mut img, bx.rect, 3, 2, [RED[0], RED[1], RED[2], 255]);
    }
    img
}

/// Draw an outline `thick` px wide, `pad` px outside the rect, clamped to the image.
pub fn draw_box(img: &mut Image, r: Rect, pad: u32, thick: u32, c: [u8; 4]) {
    let x0 = r.x.saturating_sub(pad);
    let y0 = r.y.saturating_sub(pad);
    let x1 = (r.x + r.w + pad).min(img.width); // exclusive
    let y1 = (r.y + r.h + pad).min(img.height);
    let (bw, bh) = (x1 - x0, y1 - y0);
    let t = thick;
    img.fill_rect(Rect { x: x0, y: y0, w: bw, h: t.min(bh) }, c);
    img.fill_rect(Rect { x: x0, y: y1.saturating_sub(t), w: bw, h: t.min(bh) }, c);
    img.fill_rect(Rect { x: x0, y: y0, w: t.min(bw), h: bh }, c);
    img.fill_rect(Rect { x: x1.saturating_sub(t), y: y0, w: t.min(bw), h: bh }, c);
}

// ---------------------------------------------------------------- full pipeline

pub struct Output {
    pub json: String,
    pub diff_png: Vec<u8>,
}

/// Decode both PNGs, compare, optionally render+encode the diff PNG. Used by native CLI and wasm.
pub fn run_pngs(a: &[u8], b: &[u8], opt_str: &str, render: bool) -> Result<Output, String> {
    let opts = Options::parse(opt_str)?;
    let ia = decode_png(a).map_err(|e| format!("baseline: {e}"))?;
    let ib = decode_png(b).map_err(|e| format!("current: {e}"))?;
    let res = compare(&ia, &ib, &opts);
    let diff_png = if render { encode_png(&render_diff(&ib, &res, &opts))? } else { Vec::new() };
    Ok(Output { json: res.to_json(""), diff_png })
}

// ---------------------------------------------------------------- fixtures (shared by tests and gen-fixtures)

/// Deterministic synthetic "page": header bar, text-like stripes, a button, a diagonal AA-ish edge.
pub fn synthetic_page(w: u32, h: u32) -> Image {
    let mut img = Image::new(w, h, [255, 255, 255, 255]);
    img.fill_rect(Rect { x: 0, y: 0, w, h: h / 8 }, [33, 52, 98, 255]);
    let mut y = h / 8 + 12;
    while y + 6 < h * 3 / 4 {
        let mut x = 16;
        let mut s = y;
        while x + 10 < w - 16 {
            s = s.wrapping_mul(1103515245).wrapping_add(12345);
            let len = 8 + (s >> 16) % 40;
            img.fill_rect(Rect { x, y, w: len.min(w - 16 - x), h: 6 }, [60, 60, 60, 255]);
            x += len + 6;
        }
        y += 14;
    }
    img.fill_rect(Rect { x: 16, y: h * 3 / 4 + 8, w: 90.min(w / 3), h: 24 }, [0, 120, 212, 255]);
    img
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts() -> Options {
        Options::default()
    }

    #[test]
    fn identical_images_have_zero_diff() {
        let a = synthetic_page(320, 200);
        let r = compare(&a, &a.clone(), &opts());
        assert_eq!(r.diff_pixels, 0);
        assert_eq!(r.aa_pixels, 0);
        assert!(r.boxes.is_empty());
        assert_eq!(r.percent(), 0.0);
        // also through PNG round trip
        let png = encode_png(&a).unwrap();
        let out = run_pngs(&png, &png, "", true).unwrap();
        assert!(out.json.contains("\"diffPixels\":0"));
        assert_eq!(decode_png(&png).unwrap(), a);
    }

    #[test]
    fn changed_rectangle_found_at_right_place() {
        let a = synthetic_page(320, 200);
        let mut b = a.clone();
        let changed = Rect { x: 200, y: 120, w: 40, h: 30 };
        b.fill_rect(changed, [220, 30, 30, 255]);
        let r = compare(&a, &b, &opts());
        assert_eq!(r.boxes.len(), 1, "boxes: {:?}", r.boxes);
        let bx = r.boxes[0];
        // box must lie within the painted rectangle and cover most of it
        assert!(bx.rect.x >= 200 && bx.rect.y >= 120, "{:?}", bx);
        assert!(bx.rect.x + bx.rect.w <= 240 && bx.rect.y + bx.rect.h <= 150, "{:?}", bx);
        assert!(bx.rect.w * bx.rect.h >= 30 * 20);
        assert_eq!(r.diff_pixels as u32, bx.pixels);
        // two far-apart changes -> two boxes, sorted by y
        let mut c = b.clone();
        c.fill_rect(Rect { x: 10, y: 10, w: 8, h: 8 }, [0, 255, 0, 255]);
        let r2 = compare(&a, &c, &opts());
        assert_eq!(r2.boxes.len(), 2);
        assert!(r2.boxes[0].rect.y < r2.boxes[1].rect.y);
    }

    #[test]
    fn ignore_region_suppresses_diff() {
        let a = synthetic_page(320, 200);
        let mut b = a.clone();
        b.fill_rect(Rect { x: 200, y: 120, w: 40, h: 30 }, [220, 30, 30, 255]);
        let mut o = opts();
        o.ignore.push(Rect { x: 190, y: 110, w: 60, h: 50 });
        let r = compare(&a, &b, &o);
        assert_eq!(r.diff_pixels, 0);
        assert!(r.boxes.is_empty());
        assert_eq!(r.ignored_pixels, 60 * 50);
        // partial ignore: only the uncovered part is reported
        let mut o2 = opts();
        o2.ignore.push(Rect { x: 200, y: 120, w: 20, h: 30 });
        let r2 = compare(&a, &b, &o2);
        assert_eq!(r2.boxes.len(), 1);
        assert!(r2.boxes[0].rect.x >= 220);
    }

    #[test]
    fn anti_aliasing_threshold() {
        // A dark square on white; in b, the edge column gets an intermediate (AA-like) gray.
        let mut a = Image::new(40, 40, [255, 255, 255, 255]);
        a.fill_rect(Rect { x: 10, y: 10, w: 10, h: 20 }, [0, 0, 0, 255]);
        let mut b = a.clone();
        b.fill_rect(Rect { x: 20, y: 10, w: 1, h: 20 }, [128, 128, 128, 255]);
        let r = compare(&a, &b, &opts());
        assert_eq!(r.diff_pixels, 0, "AA edge must not count as diff");
        assert!(r.aa_pixels > 0);
        let mut inc = opts();
        inc.include_aa = true;
        let r2 = compare(&a, &b, &inc);
        assert!(r2.diff_pixels > 0, "includeAA counts it");
        // threshold: a tiny color change passes at 0.1 but fails at 0.0
        let mut c = a.clone();
        c.fill_rect(Rect { x: 30, y: 30, w: 5, h: 5 }, [250, 250, 250, 255]);
        assert_eq!(compare(&a, &c, &opts()).diff_pixels, 0);
        let mut strict = opts();
        strict.threshold = 0.0;
        assert_eq!(compare(&a, &c, &strict).diff_pixels, 25);
    }

    #[test]
    fn size_mismatch_and_options_parse() {
        let a = synthetic_page(100, 80);
        let b = synthetic_page(100, 100);
        let r = compare(&a, &b, &opts());
        assert!(r.size_mismatch());
        assert_eq!((r.width, r.height), (100, 100));
        let o = Options::parse("threshold=0.2;aa=1;gap=4;ignore=1,2,3,4|5,6,7,8").unwrap();
        assert_eq!(o.threshold, 0.2);
        assert!(o.include_aa);
        assert_eq!(o.ignore.len(), 2);
        assert_eq!(Options::parse(&o.to_option_string()).unwrap(), o);
        assert!(Options::parse("threshold=2").is_err());
        assert!(Options::parse("bogus=1").is_err());
        assert!(decode_png(b"not a png").is_err());
    }

    #[test]
    fn render_marks_boxes_in_red() {
        let a = synthetic_page(120, 120);
        let mut b = a.clone();
        b.fill_rect(Rect { x: 50, y: 50, w: 10, h: 10 }, [0, 200, 0, 255]);
        let o = opts();
        let r = compare(&a, &b, &o);
        let img = render_diff(&b, &r, &o);
        // outline pixel at (50-3, 50-3)
        let k = ((47 * 120) + 47) * 4;
        assert_eq!(&img.rgba[k..k + 3], &RED);
        let k2 = ((55 * 120) + 55) * 4; // inside: overlay is reddish
        assert!(img.rgba[k2] > img.rgba[k2 + 1]);
    }
}
