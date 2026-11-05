// encdoc - 編碼醫生 CLI. Scans files/folders for encoding problems and fixes them.
//
//	encdoc [options] [path ...]                 scan (default ".")
//	encdoc --fix [options] [path ...]           show the fix plan (dry run)
//	encdoc --fix --apply [options] [path ...]   write the fixes (keeps *.bak)
//	encdoc convert --from big5 --to utf-8 [--bom] [--eol crlf|lf] IN OUT
//	encdoc version
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"encdoc/encdoc"
)

type config struct {
	fix, apply, json, all, debug, noBackup bool
	opt                                    encdoc.Options
	lang, logDir                           string
	exclude                                map[string]bool
	paths                                  []string
}

var (
	cfg     config
	logFile *os.File
	stdout  io.Writer = os.Stdout
)

func usage() {
	fmt.Fprint(os.Stderr, `encdoc `+encdoc.Version+` - 編碼醫生 Encoding Doctor

用法 Usage:
  encdoc [options] [path ...]               掃描 scan (default ".")
  encdoc --fix [options] [path ...]         預覽修復 fix plan (dry run, nothing written)
  encdoc --fix --apply [options] [path ...] 寫入修復 write fixes (original kept as *.bak)
  encdoc convert --from big5 --to utf-8 [--bom] [--eol crlf|lf] IN OUT
  encdoc version

Options:
  --json             JSON 輸出 / JSON output
  --all              也檢查未知副檔名 / include unknown extensions
  --encoding NAME    強制來源編碼 / force source encoding (utf-8, big5, gbk, shift_jis, windows-1252, utf-16le, utf-16be)
  --force-ascii      .bat 非 ASCII 字元換成 ? / replace non-ASCII in .bat with '?'
  --allow-lossy      套用會遺失字元的亂碼還原 / apply lossy mojibake repairs
  --no-backup        --apply 時不留 .bak / do not keep .bak files
  --exclude a,b      略過的資料夾名稱 / folder names to skip (default .git,node_modules)
  --lang zh|en       訊息語言 / message language (default zh)
  --debug            除錯輸出到 stderr 並寫 JSONL 記錄 / debug to stderr + JSONL log
  --log-dir DIR      記錄資料夾 / log folder (default: Windows %ProgramData%\NewMiscCode\06-encoding-doctor-wasm, else ./logs)

Exit code: 0 = 無錯誤 no errors, 1 = 有錯誤 errors found, 2 = 用法或 I/O 錯誤 usage/IO error
`)
}

func defaultLogDir() string {
	if runtime.GOOS == "windows" {
		base := os.Getenv("ProgramData")
		if base == "" {
			base = `C:\ProgramData`
		}
		return filepath.Join(base, "NewMiscCode", "06-encoding-doctor-wasm")
	}
	return "logs"
}

func logEvent(event string, kv map[string]any) {
	m := map[string]any{}
	for k, v := range kv {
		m[k] = v
	}
	kv = m
	kv["ts"] = time.Now().Format(time.RFC3339Nano)
	kv["event"] = event
	if cfg.debug {
		b, _ := json.Marshal(kv)
		fmt.Fprintln(os.Stderr, "[debug]", string(b))
	}
	if logFile != nil {
		b, _ := json.Marshal(kv)
		logFile.Write(append(b, '\n'))
	}
}

func openLog() {
	if !cfg.debug && cfg.logDir == "" {
		return
	}
	dir := cfg.logDir
	if dir == "" {
		dir = defaultLogDir()
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		fmt.Fprintln(os.Stderr, "[encdoc] cannot create log dir:", err)
		return
	}
	p := filepath.Join(dir, "encdoc-"+time.Now().Format("20060102")+".jsonl")
	f, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		fmt.Fprintln(os.Stderr, "[encdoc] cannot open log:", err)
		return
	}
	logFile = f
	if cfg.debug {
		fmt.Fprintln(os.Stderr, "[debug] log file:", p)
	}
}

func parseArgs(args []string) error {
	cfg.lang = "zh"
	cfg.exclude = map[string]bool{".git": true, "node_modules": true}
	for i := 0; i < len(args); i++ {
		a := args[i]
		val := func() (string, error) {
			if k := strings.Index(a, "="); k > 0 {
				return a[k+1:], nil
			}
			if i+1 >= len(args) {
				return "", fmt.Errorf("%s needs a value", a)
			}
			i++
			return args[i], nil
		}
		name := a
		if k := strings.Index(a, "="); k > 0 {
			name = a[:k]
		}
		var err error
		switch name {
		case "--fix":
			cfg.fix = true
		case "--apply":
			cfg.apply = true
		case "--json":
			cfg.json = true
		case "--all":
			cfg.all = true
		case "--debug":
			cfg.debug = true
		case "--no-backup":
			cfg.noBackup = true
		case "--force-ascii":
			cfg.opt.ForceASCII = true
		case "--allow-lossy":
			cfg.opt.AllowLossy = true
		case "--encoding":
			cfg.opt.Encoding, err = val()
			if err == nil && cfg.opt.Encoding != "auto" {
				_, err = encdoc.NormalizeEncoding(cfg.opt.Encoding)
			}
		case "--lang":
			cfg.lang, err = val()
		case "--log-dir":
			cfg.logDir, err = val()
		case "--exclude":
			var v string
			v, err = val()
			for _, x := range strings.Split(v, ",") {
				if x = strings.TrimSpace(x); x != "" {
					cfg.exclude[x] = true
				}
			}
		case "-h", "--help":
			usage()
			os.Exit(0)
		default:
			if strings.HasPrefix(a, "-") {
				return fmt.Errorf("unknown option %s", a)
			}
			cfg.paths = append(cfg.paths, a)
		}
		if err != nil {
			return err
		}
	}
	if cfg.apply && !cfg.fix {
		cfg.fix = true
	}
	if len(cfg.paths) == 0 {
		cfg.paths = []string{"."}
	}
	return nil
}

func msg(m encdoc.Msg) string {
	if cfg.lang == "en" {
		return m.EN
	}
	return m.ZH
}

type fileOut struct {
	Path   string            `json:"path"`
	Report encdoc.Report     `json:"report"`
	Fix    *encdoc.FixResult `json:"fix,omitempty"`
	Wrote  bool              `json:"wrote,omitempty"`
	Error  string            `json:"error,omitempty"`
}

func collect() ([]string, error) {
	var files []string
	for _, p := range cfg.paths {
		st, err := os.Stat(p)
		if err != nil {
			return nil, err
		}
		if !st.IsDir() {
			files = append(files, p)
			continue
		}
		err = filepath.WalkDir(p, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				logEvent("walk-error", map[string]any{"path": path, "error": err.Error()})
				return nil
			}
			if d.IsDir() {
				if path != p && cfg.exclude[d.Name()] {
					return filepath.SkipDir
				}
				return nil
			}
			if cfg.all || encdoc.IsTextName(d.Name()) {
				files = append(files, path)
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	sort.Strings(files)
	return files, nil
}

func runScan() int {
	files, err := collect()
	if err != nil {
		fmt.Fprintln(os.Stderr, "[encdoc] error:", err)
		return 2
	}
	logEvent("scan-start", map[string]any{"paths": cfg.paths, "files": len(files), "fix": cfg.fix, "apply": cfg.apply, "options": cfg.opt})
	var outs []fileOut
	totErr, totWarn, totFix, changed, wrote := 0, 0, 0, 0, 0
	for _, f := range files {
		data, err := os.ReadFile(f)
		if err != nil {
			outs = append(outs, fileOut{Path: f, Error: err.Error()})
			continue
		}
		start := time.Now()
		rep := encdoc.Analyze(filepath.Base(f), data, cfg.opt)
		fo := fileOut{Path: filepath.ToSlash(f), Report: rep}
		if cfg.fix && rep.FixableCount > 0 {
			fr := encdoc.Fix(filepath.Base(f), data, cfg.opt)
			fo.Fix = &fr
			if fr.Changed {
				changed++
				if cfg.apply {
					if !cfg.noBackup {
						if err := os.WriteFile(f+".bak", data, 0o644); err != nil {
							fo.Error = err.Error()
						}
					}
					if fo.Error == "" {
						if err := os.WriteFile(f, fr.Data, 0o644); err != nil {
							fo.Error = err.Error()
						} else {
							fo.Wrote = true
							wrote++
						}
					}
				}
			}
		}
		eff := rep
		if fo.Wrote {
			eff = fo.Fix.After
		}
		totErr += eff.Errors
		totWarn += eff.Warnings
		totFix += eff.FixableCount
		logEvent("file", map[string]any{"path": fo.Path, "encoding": rep.Encoding, "confidence": rep.Confidence, "bom": rep.BOM,
			"eol": rep.EOL.Style, "errors": rep.Errors, "warnings": rep.Warnings, "issues": codes(rep), "ms": time.Since(start).Milliseconds(), "wrote": fo.Wrote})
		outs = append(outs, fo)
	}
	summary := map[string]any{"files": len(files), "errors": totErr, "warnings": totWarn, "fixable": totFix, "wouldChange": changed, "written": wrote, "dryRun": cfg.fix && !cfg.apply}
	logEvent("scan-end", summary)
	if cfg.json {
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		enc.SetEscapeHTML(false)
		enc.Encode(map[string]any{"tool": "encdoc", "version": encdoc.Version, "paths": cfg.paths, "summary": summary, "files": outs})
	} else {
		printText(outs, summary)
	}
	if totErr > 0 {
		return 1
	}
	return 0
}

func codes(r encdoc.Report) []string {
	var c []string
	for _, i := range r.Issues {
		c = append(c, i.Code)
	}
	return c
}

func printText(outs []fileOut, summary map[string]any) {
	zh := cfg.lang != "en"
	for _, fo := range outs {
		r := fo.Report
		if fo.Error != "" && !fo.Wrote {
			fmt.Fprintf(stdout, "[ERR ] %s: %s\n", fo.Path, fo.Error)
			continue
		}
		tag := "[ OK ]"
		if r.Errors > 0 {
			tag = "[FAIL]"
		} else if r.Warnings > 0 {
			tag = "[WARN]"
		}
		bom := "-"
		if r.BOM != "" {
			bom = "BOM"
		}
		fmt.Fprintf(stdout, "%s %s  %s %.0f%% %s %s\n", tag, fo.Path, r.Encoding, r.Confidence*100, bom, strings.ToUpper(r.EOL.Style))
		for _, is := range r.Issues {
			fixable := ""
			if is.Fixable {
				fixable = " [fixable]"
			}
			fmt.Fprintf(stdout, "       - %s %s%s: %s\n", is.Severity, is.Code, fixable, msg(is.Message))
			label := "建議"
			if !zh {
				label = "fix"
			}
			fmt.Fprintf(stdout, "         %s: %s\n", label, msg(is.Fix))
		}
		if fo.Fix != nil && fo.Fix.Changed {
			verb := map[bool]string{true: "預計修改", false: "would change"}[zh]
			if fo.Wrote {
				verb = map[bool]string{true: "已修改", false: "fixed"}[zh]
			}
			var acts []string
			for _, a := range fo.Fix.Actions {
				acts = append(acts, msg(a.Message))
			}
			fmt.Fprintf(stdout, "       >> %s: %s (%d -> %d bytes, errors after: %d)\n", verb, strings.Join(acts, "; "), r.Size, len(fo.Fix.Data), fo.Fix.After.Errors)
		}
	}
	if zh {
		fmt.Fprintf(stdout, "\n檔案 %v 個，錯誤 %v，警告 %v，可自動修復 %v，", summary["files"], summary["errors"], summary["warnings"], summary["fixable"])
		if cfg.apply {
			fmt.Fprintf(stdout, "已寫入 %v 個檔案（原檔保留為 .bak）。\n", summary["written"])
		} else if cfg.fix {
			fmt.Fprintf(stdout, "預覽模式：%v 個檔案會被修改（加上 --apply 才會寫入）。\n", summary["wouldChange"])
		} else {
			fmt.Fprintln(stdout, "加上 --fix 預覽修復。")
		}
	} else {
		fmt.Fprintf(stdout, "\nfiles %v, errors %v, warnings %v, fixable %v; ", summary["files"], summary["errors"], summary["warnings"], summary["fixable"])
		if cfg.apply {
			fmt.Fprintf(stdout, "wrote %v files (originals kept as .bak).\n", summary["written"])
		} else if cfg.fix {
			fmt.Fprintf(stdout, "dry run: %v files would change (add --apply to write).\n", summary["wouldChange"])
		} else {
			fmt.Fprintln(stdout, "add --fix to preview fixes.")
		}
	}
}

func runConvert(args []string) int {
	var o encdoc.ConvertOptions
	var pos []string
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--from", "--to", "--eol":
			if i+1 >= len(args) {
				fmt.Fprintln(os.Stderr, args[i], "needs a value")
				return 2
			}
			v := args[i+1]
			switch args[i] {
			case "--from":
				o.From = v
			case "--to":
				o.To = v
			default:
				o.EOL = v
			}
			i++
		case "--bom":
			o.BOM = true
		case "--debug":
			cfg.debug = true
		default:
			pos = append(pos, args[i])
		}
	}
	if len(pos) != 2 {
		usage()
		return 2
	}
	data, err := os.ReadFile(pos[0])
	if err != nil {
		fmt.Fprintln(os.Stderr, "[encdoc]", err)
		return 2
	}
	out, lost, err := encdoc.Convert(data, o)
	if err != nil {
		fmt.Fprintln(os.Stderr, "[encdoc]", err)
		return 2
	}
	if err := os.WriteFile(pos[1], out, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "[encdoc]", err)
		return 2
	}
	fmt.Fprintf(stdout, "%s -> %s (%d bytes, lost %d)\n", pos[0], pos[1], len(out), lost)
	logEvent("convert", map[string]any{"in": pos[0], "out": pos[1], "opts": o, "lost": lost})
	if lost > 0 {
		return 1
	}
	return 0
}

func main() {
	args := os.Args[1:]
	if len(args) > 0 {
		switch args[0] {
		case "version", "--version":
			fmt.Println("encdoc", encdoc.Version, runtime.Version(), runtime.GOOS+"/"+runtime.GOARCH)
			return
		case "convert":
			os.Exit(runConvert(args[1:]))
		case "scan":
			args = args[1:]
		}
	}
	if err := parseArgs(args); err != nil {
		fmt.Fprintln(os.Stderr, "[encdoc]", err)
		usage()
		os.Exit(2)
	}
	openLog()
	code := runScan()
	logEvent("exit", map[string]any{"code": code})
	if logFile != nil {
		logFile.Close()
	}
	os.Exit(code)
}
