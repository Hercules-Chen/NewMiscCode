//! vr-native: native build of the same vr-core used by the WebAssembly module.
//!
//!   vr-native compare <baseline.png> <current.png> [--out diff.png] [--threshold 0.1]
//!                     [--ignore x,y,w,h]... [--aa] [--gap 8] [--min-pixels 1]
//!   vr-native bench <baseline.png> <current.png> [--iter 10] [same options]
//!   vr-native gen-fixtures <dir>
//!   vr-native --version
//!
//! `compare` prints the same JSON the wasm module returns (exit code 0 = no diff, 1 = diff, 2 = error).

use std::process::ExitCode;
use std::time::Instant;
use vr_core::*;

fn usage() -> ExitCode {
    eprintln!("usage: vr-native compare <baseline.png> <current.png> [--out diff.png] [--threshold 0.1] [--ignore x,y,w,h]... [--aa] [--gap N] [--min-pixels N]\n       vr-native bench <a.png> <b.png> [--iter N] [options]\n       vr-native gen-fixtures <dir>\n       vr-native --version");
    ExitCode::from(2)
}

struct Args {
    pos: Vec<String>,
    out: Option<String>,
    iter: u32,
    opts: Options,
}

fn parse(args: &[String]) -> Result<Args, String> {
    let mut a = Args { pos: Vec::new(), out: None, iter: 10, opts: Options::default() };
    let mut i = 0;
    let val = |i: usize| args.get(i + 1).cloned().ok_or_else(|| format!("missing value for {}", args[i]));
    while i < args.len() {
        match args[i].as_str() {
            "--out" => { a.out = Some(val(i)?); i += 1; }
            "--threshold" => { a.opts.threshold = val(i)?.parse().map_err(|_| "bad --threshold")?; i += 1; }
            "--ignore" => { a.opts.ignore.push(parse_rect(&val(i)?)?); i += 1; }
            "--gap" => { a.opts.gap = val(i)?.parse().map_err(|_| "bad --gap")?; i += 1; }
            "--min-pixels" => { a.opts.min_pixels = val(i)?.parse().map_err(|_| "bad --min-pixels")?; i += 1; }
            "--iter" => { a.iter = val(i)?.parse().map_err(|_| "bad --iter")?; i += 1; }
            "--aa" => a.opts.include_aa = true,
            s if s.starts_with("--") => return Err(format!("unknown flag {s}")),
            s => a.pos.push(s.to_string()),
        }
        i += 1;
    }
    if !(0.0..=1.0).contains(&a.opts.threshold) {
        return Err("--threshold must be within 0..1".into());
    }
    Ok(a)
}

fn read(p: &str) -> Result<Vec<u8>, String> {
    std::fs::read(p).map_err(|e| format!("cannot read {p}: {e}"))
}

fn main() -> ExitCode {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = argv.first().cloned() else { return usage() };
    if cmd == "--version" || cmd == "-V" {
        println!("vr-native {VERSION}");
        return ExitCode::SUCCESS;
    }
    let args = match parse(&argv[1..]) {
        Ok(a) => a,
        Err(e) => { eprintln!("error: {e}"); return usage(); }
    };
    let res = match cmd.as_str() {
        "compare" => cmd_compare(&args),
        "bench" => cmd_bench(&args),
        "gen-fixtures" => cmd_gen(&args),
        _ => return usage(),
    };
    match res {
        Ok(code) => ExitCode::from(code),
        Err(e) => { println!("{}", error_json(&e)); eprintln!("error: {e}"); ExitCode::from(2) }
    }
}

fn cmd_compare(a: &Args) -> Result<u8, String> {
    if a.pos.len() != 2 { return Err("compare needs <baseline.png> <current.png>".into()); }
    let (ba, bb) = (read(&a.pos[0])?, read(&a.pos[1])?);
    let t = Instant::now();
    let out = run_pngs(&ba, &bb, &a.opts.to_option_string(), a.out.is_some())?;
    let ms = t.elapsed().as_secs_f64() * 1000.0;
    if let Some(p) = &a.out {
        std::fs::write(p, &out.diff_png).map_err(|e| format!("cannot write {p}: {e}"))?;
    }
    println!("{}", out.json);
    eprintln!("[vr-native] {:.2} ms", ms);
    Ok(if out.json.contains("\"diffPixels\":0,") { 0 } else { 1 })
}

fn cmd_bench(a: &Args) -> Result<u8, String> {
    if a.pos.len() != 2 { return Err("bench needs <a.png> <b.png>".into()); }
    let (ba, bb) = (read(&a.pos[0])?, read(&a.pos[1])?);
    let opt = a.opts.to_option_string();
    run_pngs(&ba, &bb, &opt, true)?; // warm-up
    let n = a.iter.max(1);
    let mut times = Vec::new();
    let (mut td, mut tc, mut tr) = (0.0, 0.0, 0.0);
    for _ in 0..n {
        let t0 = Instant::now();
        let ia = decode_png(&ba)?;
        let ib = decode_png(&bb)?;
        let t1 = Instant::now();
        let res = compare(&ia, &ib, &a.opts);
        let t2 = Instant::now();
        let png = encode_png(&render_diff(&ib, &res, &a.opts))?;
        let t3 = Instant::now();
        std::hint::black_box(png);
        td += (t1 - t0).as_secs_f64();
        tc += (t2 - t1).as_secs_f64();
        tr += (t3 - t2).as_secs_f64();
        times.push((t3 - t0).as_secs_f64() * 1000.0);
    }
    times.sort_by(|x, y| x.partial_cmp(y).unwrap());
    let f = n as f64;
    println!(
        "{{\"engine\":\"native\",\"iterations\":{n},\"medianMs\":{:.3},\"minMs\":{:.3},\"decodeMs\":{:.3},\"compareMs\":{:.3},\"renderEncodeMs\":{:.3}}}",
        times[times.len() / 2], times[0], td * 1000.0 / f, tc * 1000.0 / f, tr * 1000.0 / f
    );
    Ok(0)
}

fn cmd_gen(a: &Args) -> Result<u8, String> {
    let dir = a.pos.first().ok_or("gen-fixtures needs <dir>")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let base = synthetic_page(320, 200);
    let mut cur = base.clone();
    cur.fill_rect(Rect { x: 200, y: 120, w: 40, h: 30 }, [220, 30, 30, 255]); // changed block
    cur.fill_rect(Rect { x: 16, y: 158, w: 90, h: 24 }, [0, 150, 90, 255]); // button colour change
    let mut big_a = synthetic_page(1600, 1200);
    let mut big_b = big_a.clone();
    big_b.fill_rect(Rect { x: 900, y: 500, w: 300, h: 120 }, [250, 200, 40, 255]);
    big_b.fill_rect(Rect { x: 100, y: 1000, w: 60, h: 60 }, [20, 20, 20, 255]);
    big_a.fill_rect(Rect { x: 0, y: 0, w: 1, h: 1 }, [33, 52, 98, 255]);
    let w = |name: &str, img: &Image| -> Result<(), String> {
        let p = format!("{dir}/{name}");
        std::fs::write(&p, encode_png(img)?).map_err(|e| e.to_string())?;
        println!("wrote {p}");
        Ok(())
    };
    w("base.png", &base)?;
    w("current.png", &cur)?;
    w("big-a.png", &big_a)?;
    w("big-b.png", &big_b)?;
    Ok(0)
}
