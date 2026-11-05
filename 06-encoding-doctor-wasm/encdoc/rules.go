package encdoc

import (
	"bytes"
	"fmt"
	"path"
	"strings"
	"unicode/utf8"
)

// Msg is a bilingual message.
type Msg struct {
	ZH string `json:"zh"`
	EN string `json:"en"`
}

// Issue is one finding for a file.
type Issue struct {
	Code     string `json:"code"`
	Severity string `json:"severity"` // error | warning | info
	Fixable  bool   `json:"fixable"`
	Message  Msg    `json:"message"`
	Fix      Msg    `json:"fix"`
}

// Report is the full diagnosis of one file.
type Report struct {
	Name         string      `json:"name"`
	Ext          string      `json:"ext"`
	Size         int         `json:"size"`
	Policy       string      `json:"policy"`
	Encoding     string      `json:"encoding"`
	Confidence   float64     `json:"confidence"`
	BOM          string      `json:"bom"`
	Candidates   []Candidate `json:"candidates"`
	EOL          EOLStats    `json:"eol"`
	NonASCII     int         `json:"nonAscii"` // non-ASCII characters in the decoded text
	NUL          int         `json:"nul"`
	Replacement  int         `json:"replacementChars"`
	Invalid      int         `json:"invalidSequences"`
	Mojibake     *Mojibake   `json:"mojibake,omitempty"`
	Issues       []Issue     `json:"issues"`
	Errors       int         `json:"errors"`
	Warnings     int         `json:"warnings"`
	FixableCount int         `json:"fixable"`
	Preview      string      `json:"preview"`
	PreviewFixed string      `json:"previewFixed,omitempty"`
	Text         string      `json:"-"`
}

// Policies (the user's per-file-type rules).
const (
	PolicyBat     = "bat"        // .bat/.cmd: ASCII + CRLF, no BOM
	PolicyPS1     = "ps1"        // .ps1/.psm1/.psd1: UTF-8 with BOM if non-ASCII
	PolicyUTF8    = "utf8-nobom" // .md/.json/.js/.html/...: UTF-8 without BOM
	PolicyShell   = "sh"         // .sh: UTF-8 + LF
	PolicyGeneric = "text"       // other known text files: diagnosis only
	PolicyNone    = ""           // unknown extension
)

var policyByExt = map[string]string{
	".bat": PolicyBat, ".cmd": PolicyBat,
	".ps1": PolicyPS1, ".psm1": PolicyPS1, ".psd1": PolicyPS1,
	".md": PolicyUTF8, ".markdown": PolicyUTF8, ".json": PolicyUTF8, ".js": PolicyUTF8, ".mjs": PolicyUTF8, ".cjs": PolicyUTF8,
	".ts": PolicyUTF8, ".html": PolicyUTF8, ".htm": PolicyUTF8, ".css": PolicyUTF8, ".svg": PolicyUTF8, ".jsonl": PolicyUTF8,
	".sh":  PolicyShell,
	".txt": PolicyGeneric, ".csv": PolicyGeneric, ".tsv": PolicyGeneric, ".xml": PolicyGeneric, ".yml": PolicyGeneric, ".yaml": PolicyGeneric,
	".ini": PolicyGeneric, ".cfg": PolicyGeneric, ".conf": PolicyGeneric, ".log": PolicyGeneric, ".py": PolicyGeneric, ".go": PolicyGeneric,
	".c": PolicyGeneric, ".h": PolicyGeneric, ".cpp": PolicyGeneric, ".cs": PolicyGeneric, ".java": PolicyGeneric, ".sql": PolicyGeneric,
	".reg": PolicyGeneric, ".srt": PolicyGeneric, ".properties": PolicyGeneric, ".toml": PolicyGeneric, ".vbs": PolicyGeneric,
}

// PolicyFor returns the policy name for a file name.
func PolicyFor(name string) string {
	return policyByExt[strings.ToLower(path.Ext(strings.ReplaceAll(name, "\\", "/")))]
}

// IsTextName reports whether the extension is one the tool knows as text.
func IsTextName(name string) bool { return PolicyFor(name) != PolicyNone }

// Options tune Analyze / Fix.
type Options struct {
	Encoding   string `json:"encoding"`   // force a source encoding ("" or "auto" = detect)
	ForceASCII bool   `json:"forceAscii"` // .bat: replace non-ASCII characters with '?'
	AllowLossy bool   `json:"allowLossy"` // apply mojibake repairs that lose characters
}

func (r *Report) add(code, sev string, fixable bool, zh, en, fixZh, fixEn string) {
	r.Issues = append(r.Issues, Issue{Code: code, Severity: sev, Fixable: fixable, Message: Msg{zh, en}, Fix: Msg{fixZh, fixEn}})
	switch sev {
	case "error":
		r.Errors++
	case "warning":
		r.Warnings++
	}
	if fixable {
		r.FixableCount++
	}
}

func encLabel(enc, bom string) string {
	if bom != "" {
		return enc + " (BOM)"
	}
	return enc
}

func isLegacy(enc string) bool {
	switch enc {
	case EncBig5, EncGBK, EncSJIS, EncCP1252:
		return true
	}
	return false
}

func isUTF16(enc string) bool { return enc == EncUTF16LE || enc == EncUTF16BE }

const previewRunes = 4000

// Analyze diagnoses one file.
func Analyze(name string, data []byte, opt Options) Report {
	r := Report{Name: name, Ext: strings.ToLower(path.Ext(strings.ReplaceAll(name, "\\", "/"))), Size: len(data), Policy: PolicyFor(name)}
	r.NUL = bytes.Count(data, []byte{0})
	var det Detection
	if opt.Encoding != "" && opt.Encoding != "auto" {
		enc, err := NormalizeEncoding(opt.Encoding)
		if err == nil {
			bom, n := SniffBOM(data)
			if bom != "" && bom != enc {
				bom, n = "", 0
			}
			text, inv, _ := Decode(data[n:], enc)
			det = Detection{Encoding: enc, Confidence: 1, BOM: bom, Invalid: inv, Text: text,
				Candidates: []Candidate{{Encoding: enc, Confidence: 1, Invalid: inv, Sample: firstNonASCIIContext(text)}}}
		} else {
			det = Detect(data)
		}
	} else {
		det = Detect(data)
	}
	r.Encoding, r.Confidence, r.BOM, r.Candidates, r.Invalid, r.Text = det.Encoding, round3(det.Confidence), det.BOM, det.Candidates, det.Invalid, det.Text
	if r.Encoding == EncBinary {
		r.add("binary", "info", false, "看起來是二進位檔，略過文字檢查。", "Looks like a binary file; text checks skipped.", "無需處理。", "Nothing to do.")
		r.Issues = append([]Issue{}, r.Issues...)
		return r
	}
	for _, c := range r.Text {
		if c >= 0x80 {
			r.NonASCII++
		}
	}
	r.Replacement = utf8.RuneCountInString(r.Text) - utf8.RuneCountInString(strings.ReplaceAll(r.Text, "\uFFFD", ""))
	r.EOL = CountEOL(r.Text)
	r.Preview = sample(r.Text, previewRunes)
	if r.Encoding == EncUTF8 || r.Encoding == EncASCII {
		r.Mojibake = DetectMojibake(r.Text)
	}
	if r.Mojibake != nil {
		r.PreviewFixed = sample(r.Mojibake.Fixed, previewRunes)
	}
	encName := encLabel(r.Encoding, r.BOM)
	conf := fmt.Sprintf("%.0f%%", r.Confidence*100)

	// ---- generic checks (all text files) ----
	if r.Mojibake != nil {
		m := r.Mojibake
		lossZh, lossEn := "可完整還原", "fully reversible"
		if m.Lossy {
			lossZh, lossEn = fmt.Sprintf("有 %d 個字元無法還原", m.Lost), fmt.Sprintf("%d characters cannot be restored", m.Lost)
		}
		r.add("mojibake", "error", !m.Lossy || opt.AllowLossy,
			fmt.Sprintf("疑似亂碼：UTF-8 內容曾被誤用 %s 解讀後再存檔（%s）。還原範例：「%s」", m.Via, lossZh, m.Sample),
			fmt.Sprintf("Mojibake: UTF-8 text was decoded as %s and saved again (%s). Repaired sample: \"%s\"", m.Via, lossEn, m.Sample),
			"反向轉換：以 "+m.Via+" 編回位元組，再用 UTF-8 解碼。", "Reverse it: encode back to "+m.Via+" bytes and decode as UTF-8.")
	}
	if r.Invalid > 0 && (r.Encoding == EncUTF8) {
		r.add("invalid-utf8", "error", false,
			fmt.Sprintf("看起來是 UTF-8，但有 %d 個無效位元組序列（可能被以 ANSI 存檔過）。", r.Invalid),
			fmt.Sprintf("Looks like UTF-8 but has %d invalid byte sequences (maybe saved as ANSI once).", r.Invalid),
			"資料已部分遺失，請找回原始檔；或在預覽中改選其他編碼確認。", "Data is partly lost; recover the original or try another encoding in the preview.")
	} else if r.Invalid > 0 {
		r.add("decode-errors", "warning", false,
			fmt.Sprintf("以 %s 解碼時有 %d 個無法解碼的位元組。", r.Encoding, r.Invalid),
			fmt.Sprintf("%d undecodable bytes when decoding as %s.", r.Invalid, r.Encoding),
			"在預覽中嘗試其他編碼。", "Try another encoding in the preview.")
	}
	if lit := r.Replacement - r.Invalid; lit > 0 {
		r.add("replacement-char", "warning", false,
			fmt.Sprintf("檔案內含 %d 個 U+FFFD取代字元：先前的轉換已遺失資料。", lit),
			fmt.Sprintf("Contains %d U+FFFD replacement characters: an earlier conversion lost data.", lit),
			"無法自動修復，請從備份或原始來源找回內容。", "Cannot be repaired automatically; restore from a backup or the original source.")
	}
	if r.NUL > 0 && !isUTF16(r.Encoding) {
		r.add("nul-bytes", "warning", false,
			fmt.Sprintf("含有 %d 個 NUL (0x00) 位元組，可能是 UTF-16 被截斷或混入二進位資料。", r.NUL),
			fmt.Sprintf("Contains %d NUL (0x00) bytes: truncated UTF-16 or binary data mixed in.", r.NUL),
			"確認來源；必要時以 UTF-16 重新解讀。", "Check the source; re-read as UTF-16 if needed.")
	}
	if isLegacy(r.Encoding) && r.Confidence < 0.6 {
		r.add("low-confidence", "info", false,
			fmt.Sprintf("編碼判斷信心度偏低（%s 為 %s），請在預覽中確認。", r.Encoding, conf),
			fmt.Sprintf("Low detection confidence (%s at %s); confirm in the preview.", r.Encoding, conf),
			"用預覽的編碼選單逐一比較。", "Compare encodings with the preview selector.")
	}
	if r.EOL.Style == "mixed" && r.Policy != PolicyBat && r.Policy != PolicyShell {
		d := strings.ToUpper(r.EOL.Dominant())
		r.add("mixed-eol", "warning", true,
			fmt.Sprintf("換行混用：CRLF %d、LF %d、CR %d。", r.EOL.CRLF, r.EOL.LF, r.EOL.CR),
			fmt.Sprintf("Mixed line endings: CRLF %d, LF %d, CR %d.", r.EOL.CRLF, r.EOL.LF, r.EOL.CR),
			"統一為多數的 "+d+"。", "Normalize to the majority style "+d+".")
	}

	// ---- policy checks ----
	switch r.Policy {
	case PolicyBat:
		if r.BOM != "" {
			r.add("bat-bom", "error", true,
				"批次檔有 BOM：cmd.exe 會把 BOM 當成第一行指令的一部分（出現「'\uFEFF@echo' 不是內部或外部命令」）。",
				"Batch file has a BOM: cmd.exe treats it as part of the first command (\"'\uFEFF@echo' is not recognized\").",
				"移除 BOM。", "Remove the BOM.")
		}
		if r.NonASCII > 0 {
			r.add("bat-non-ascii", "error", opt.ForceASCII,
				fmt.Sprintf("批次檔含 %d 個非 ASCII 字元（目前判斷為 %s）。cmd.exe 依目前代碼頁（chcp 950/65001）解讀，換台電腦就變亂碼。", r.NonASCII, encName),
				fmt.Sprintf("Batch file has %d non-ASCII characters (detected %s). cmd.exe reads it with the active code page (chcp 950/65001), so it breaks on other machines.", r.NonASCII, encName),
				"把中文訊息移到 .ps1（UTF-8 BOM）；或用 --force-ascii 將非 ASCII 字元換成 ?。", "Move Chinese messages into a .ps1 (UTF-8 BOM), or use --force-ascii to replace them with '?'.")
		}
		if r.EOL.Style != "crlf" && r.EOL.Style != "none" {
			r.add("bat-eol", "error", true,
				fmt.Sprintf("批次檔必須使用 CRLF 換行（目前 %s：CRLF %d、LF %d）。LF 會讓 goto/call 標籤錯亂。", r.EOL.Style, r.EOL.CRLF, r.EOL.LF),
				fmt.Sprintf("Batch files must use CRLF (now %s: CRLF %d, LF %d). LF breaks goto/call label lookup.", r.EOL.Style, r.EOL.CRLF, r.EOL.LF),
				"轉為 CRLF。", "Convert to CRLF.")
		}
	case PolicyPS1:
		if r.NonASCII > 0 && !(r.Encoding == EncUTF8 && r.BOM == EncUTF8) {
			if isUTF16(r.Encoding) && r.BOM != "" {
				r.add("ps1-utf16", "warning", true,
					"PowerShell 腳本為 UTF-16（PS 5.1 可讀，但 git diff 與多數工具不友善）。",
					"PowerShell script is UTF-16 (PS 5.1 reads it, but git and most tools do not like it).",
					"轉為 UTF-8 with BOM。", "Convert to UTF-8 with BOM.")
			} else {
				r.add("ps1-bom-missing", "error", true,
					fmt.Sprintf("含非 ASCII 字元的 .ps1 必須是 UTF-8 with BOM（目前 %s）。Windows PowerShell 5.1 沒有 BOM 時用 ANSI（CP950）讀取，中文變亂碼。", encName),
					fmt.Sprintf(".ps1 with non-ASCII text must be UTF-8 with BOM (now %s). Windows PowerShell 5.1 reads BOM-less files as ANSI (CP950) and garbles them.", encName),
					"轉為 UTF-8 並加上 BOM。", "Convert to UTF-8 and add a BOM.")
			}
		}
	case PolicyUTF8, PolicyShell:
		if r.Encoding == EncUTF8 && r.BOM != "" {
			r.add("utf8-bom-unexpected", "error", true,
				"此類檔案應為 UTF-8 無 BOM（BOM 會破壞 JSON.parse、shebang、部分 Markdown/HTML 工具）。",
				"This file type must be UTF-8 without BOM (a BOM breaks JSON.parse, shebangs and some Markdown/HTML tools).",
				"移除 BOM。", "Remove the BOM.")
		}
		if isLegacy(r.Encoding) || isUTF16(r.Encoding) {
			r.add("not-utf8", "error", true,
				fmt.Sprintf("此類檔案應為 UTF-8，目前判斷為 %s（信心度 %s）。", encName, conf),
				fmt.Sprintf("This file type must be UTF-8; detected %s (confidence %s).", encName, conf),
				"從 "+r.Encoding+" 轉為 UTF-8（無 BOM）。", "Convert from "+r.Encoding+" to UTF-8 (no BOM).")
		}
		if r.Policy == PolicyShell && (r.EOL.CRLF > 0 || r.EOL.CR > 0) {
			r.add("sh-eol", "error", true,
				"Shell 腳本必須用 LF 換行（CRLF 會出現 $'\\r': command not found）。",
				"Shell scripts must use LF (CRLF causes $'\\r': command not found).",
				"轉為 LF。", "Convert to LF.")
		}
	case PolicyGeneric:
		if isLegacy(r.Encoding) {
			r.add("legacy-encoding", "warning", true,
				fmt.Sprintf("使用舊式編碼 %s（信心度 %s），建議改為 UTF-8。", r.Encoding, conf),
				fmt.Sprintf("Uses the legacy encoding %s (confidence %s); UTF-8 is recommended.", r.Encoding, conf),
				"轉為 UTF-8（無 BOM）。", "Convert to UTF-8 (no BOM).")
		}
	}
	if r.Issues == nil {
		r.Issues = []Issue{}
	}
	return r
}

// Action describes one change made by Fix.
type Action struct {
	Code    string `json:"code"`
	Message Msg    `json:"message"`
}

// FixResult is the outcome of Fix.
type FixResult struct {
	Changed bool     `json:"changed"`
	Actions []Action `json:"actions"`
	Before  Report   `json:"before"`
	After   Report   `json:"after"`
	Data    []byte   `json:"-"`
	Lost    int      `json:"lost"`
}

// Fix applies the file-type policy and returns the repaired bytes.
func Fix(name string, data []byte, opt Options) FixResult {
	rep := Analyze(name, data, opt)
	res := FixResult{Before: rep, Data: data, Actions: []Action{}}
	if rep.Encoding == EncBinary {
		res.After = rep
		return res
	}
	act := func(code, zh, en string) { res.Actions = append(res.Actions, Action{code, Msg{zh, en}}) }
	text := rep.Text
	if m := rep.Mojibake; m != nil && (!m.Lossy || opt.AllowLossy) {
		text = m.Fixed
		act("mojibake", "還原亂碼（UTF-8 被誤讀為 "+m.Via+"）", "repaired mojibake (UTF-8 read as "+m.Via+")")
	}
	nonASCII := strings.IndexFunc(text, func(r rune) bool { return r >= 0x80 }) >= 0

	targetEnc, targetBOM, eol := rep.Encoding, rep.BOM != "", ""
	if rep.Encoding == EncASCII {
		targetEnc = EncUTF8
	}
	if rep.EOL.Style == "mixed" {
		eol = rep.EOL.Dominant()
	}
	switch rep.Policy {
	case PolicyBat:
		eol = "crlf"
		targetBOM = false
		if !nonASCII {
			targetEnc = EncUTF8 // = ASCII
		} else if opt.ForceASCII {
			targetEnc = EncASCII
		} else if isUTF16(targetEnc) {
			targetEnc = EncUTF8
		}
	case PolicyPS1:
		if nonASCII {
			targetEnc, targetBOM = EncUTF8, true
		}
	case PolicyUTF8, PolicyShell:
		targetEnc, targetBOM = EncUTF8, false
		if rep.Policy == PolicyShell {
			eol = "lf"
		}
	case PolicyGeneric:
		if isLegacy(targetEnc) {
			targetEnc, targetBOM = EncUTF8, false
		}
	}
	if eol != "" {
		nt := NormalizeEOL(text, eol)
		if nt != text {
			act("eol", "換行統一為 "+strings.ToUpper(eol), "line endings normalized to "+strings.ToUpper(eol))
		}
		text = nt
	}
	out, lost, err := EncodeWithBOM(text, targetEnc, targetBOM)
	if err != nil {
		res.After = rep
		return res
	}
	res.Lost = lost
	if targetEnc != rep.Encoding && !(rep.Encoding == EncASCII && targetEnc == EncUTF8) {
		act("encoding", "編碼 "+rep.Encoding+" → "+targetEnc, "encoding "+rep.Encoding+" → "+targetEnc)
	}
	if lost > 0 {
		act("lost", fmt.Sprintf("%d 個字元無法以 %s 表示，已換成 ?", lost, targetEnc), fmt.Sprintf("%d characters not representable in %s were replaced by '?'", lost, targetEnc))
	}
	if (rep.BOM != "") != targetBOM || (targetBOM && rep.BOM != targetEnc) {
		if targetBOM {
			act("bom", "加上 "+targetEnc+" BOM", "added "+targetEnc+" BOM")
		} else {
			act("bom", "移除 BOM", "removed BOM")
		}
	}
	res.Changed = !bytes.Equal(out, data)
	res.Data = out
	afterOpt := Options{ForceASCII: opt.ForceASCII, AllowLossy: opt.AllowLossy}
	res.After = Analyze(name, out, afterOpt)
	return res
}

// ConvertOptions drive Convert.
type ConvertOptions struct {
	From string `json:"from"` // "" / "auto" = detect
	To   string `json:"to"`
	BOM  bool   `json:"bom"`
	EOL  string `json:"eol"` // "" keep | crlf | lf
}

// Convert re-encodes data. It returns the new bytes and the number of lost characters.
func Convert(data []byte, o ConvertOptions) ([]byte, int, error) {
	var text string
	if o.From == "" || o.From == "auto" {
		det := Detect(data)
		if det.Encoding == EncBinary {
			return nil, 0, fmt.Errorf("binary input")
		}
		text = det.Text
	} else {
		enc, err := NormalizeEncoding(o.From)
		if err != nil {
			return nil, 0, err
		}
		bom, n := SniffBOM(data)
		if bom != enc {
			n = 0
		}
		text, _, _ = Decode(data[n:], enc)
	}
	if o.EOL != "" && o.EOL != "keep" {
		text = NormalizeEOL(text, o.EOL)
	}
	to := o.To
	if to == "" {
		to = EncUTF8
	}
	return EncodeWithBOM(text, to, o.BOM)
}
