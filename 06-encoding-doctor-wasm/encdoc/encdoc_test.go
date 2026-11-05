package encdoc

import (
	"bytes"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func readTD(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "testdata", name))
	if err != nil {
		t.Fatalf("missing testdata (run: go run ./cmd/gentestdata): %v", err)
	}
	return b
}

func codesOf(r Report) []string {
	var c []string
	for _, i := range r.Issues {
		c = append(c, i.Code)
	}
	return c
}

func TestDetectTestdata(t *testing.T) {
	cases := []struct {
		file    string
		enc     string
		bom     string
		minConf float64
		eol     string
		issues  []string // exact set of issue codes
	}{
		{"big5-notes.txt", EncBig5, "", 0.8, "crlf", []string{"legacy-encoding"}},
		{"big5-readme.md", EncBig5, "", 0.8, "crlf", []string{"not-utf8"}},
		{"gbk-simplified.txt", EncGBK, "", 0.7, "crlf", []string{"legacy-encoding"}},
		{"sjis-japanese.txt", EncSJIS, "", 0.7, "crlf", []string{"legacy-encoding"}},
		{"utf16le-bom.txt", EncUTF16LE, EncUTF16LE, 1, "crlf", nil},
		{"bom-readme.md", EncUTF8, EncUTF8, 1, "lf", []string{"utf8-bom-unexpected"}},
		{"good.md", EncUTF8, "", 0.9, "lf", nil},
		{"good.json", EncUTF8, "", 0.9, "lf", nil},
		{"good.bat", EncASCII, "", 1, "crlf", nil},
		{"chinese-echo.bat", EncUTF8, "", 0.9, "lf", []string{"bat-non-ascii", "bat-eol"}},
		{"bom.cmd", EncUTF8, EncUTF8, 1, "crlf", []string{"bat-bom"}},
		{"no-bom.ps1", EncUTF8, "", 0.9, "crlf", []string{"ps1-bom-missing"}},
		{"big5-ansi.ps1", EncBig5, "", 0.5, "crlf", []string{"ps1-bom-missing"}},
		{"good.ps1", EncUTF8, EncUTF8, 1, "crlf", nil},
		{"ascii-only.ps1", EncASCII, "", 1, "crlf", nil},
		{"mixed-eol.js", EncUTF8, "", 0.9, "mixed", []string{"mixed-eol"}},
		{"crlf.sh", EncASCII, "", 1, "crlf", []string{"sh-eol"}},
		{"mojibake-latin1.md", EncUTF8, "", 0.9, "lf", []string{"mojibake"}},
		{"mojibake-cp950.txt", EncUTF8, "", 0.9, "lf", []string{"mojibake", "replacement-char"}},
		{"lost-fffd.txt", EncUTF8, "", 0.9, "lf", []string{"replacement-char"}},
		{"nul-bytes.txt", EncASCII, "", 1, "lf", []string{"nul-bytes"}},
	}
	for _, c := range cases {
		t.Run(c.file, func(t *testing.T) {
			r := Analyze(c.file, readTD(t, c.file), Options{})
			if r.Encoding != c.enc || r.BOM != c.bom {
				t.Errorf("encoding=%s bom=%q, want %s %q (candidates %+v)", r.Encoding, r.BOM, c.enc, c.bom, r.Candidates)
			}
			if r.Confidence < c.minConf {
				t.Errorf("confidence %.3f < %.2f", r.Confidence, c.minConf)
			}
			if r.EOL.Style != c.eol {
				t.Errorf("eol=%s want %s", r.EOL.Style, c.eol)
			}
			got := strings.Join(codesOf(r), ",")
			if got != strings.Join(c.issues, ",") {
				t.Errorf("issues=[%s] want [%s]", got, strings.Join(c.issues, ","))
			}
		})
	}
}

func TestDetectStrings(t *testing.T) {
	trad := "這是一段繁體中文的測試文字，請確認編碼是否正確。設定檔案已經儲存完成。"
	simp := "这是一段简体中文的测试文字，请确认编码是否正确。设置已经保存完成。"
	cases := []struct {
		name string
		data []byte
		want string
	}{
		{"trad big5", mustEnc(t, trad, EncBig5), EncBig5},
		{"simp gbk", mustEnc(t, simp, EncGBK), EncGBK},
		{"trad utf8", []byte(trad), EncUTF8},
		{"ascii", []byte("hello\r\n"), EncASCII},
		{"latin1", mustEnc(t, "Café crème brûlée à la française, déjà vu.", EncCP1252), EncCP1252},
		{"utf16le no bom", mustEnc(t, "hello world, plain text", EncUTF16LE), EncUTF16LE},
		{"binary", []byte{0x89, 'P', 'N', 'G', 0, 0, 0, 0x0d, 1, 2, 3, 0, 0, 0, 0, 0}, EncBinary},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if d := Detect(c.data); d.Encoding != c.want {
				t.Errorf("got %s want %s (%+v)", d.Encoding, c.want, d.Candidates)
			}
		})
	}
}

func mustEnc(t *testing.T, s, enc string) []byte {
	b, lost, err := Encode(s, enc)
	if err != nil || lost != 0 {
		t.Fatalf("encode %s: lost=%d err=%v", enc, lost, err)
	}
	return b
}

func TestConvertRoundTrip(t *testing.T) {
	src := "第一行：編碼醫生\n第二行 ABC\n"
	for _, enc := range []string{EncUTF8, EncBig5, EncUTF16LE, EncUTF16BE} {
		for _, bom := range []bool{false, true} {
			if bom && enc == EncBig5 {
				continue
			}
			b, lost, err := EncodeWithBOM(src, enc, bom)
			if err != nil || lost != 0 {
				t.Fatalf("%s: %v %d", enc, err, lost)
			}
			out, lost, err := Convert(b, ConvertOptions{From: enc, To: EncUTF8, EOL: "crlf"})
			if err != nil || lost != 0 {
				t.Fatalf("convert %s: %v %d", enc, err, lost)
			}
			if string(out) != strings.ReplaceAll(src, "\n", "\r\n") {
				t.Errorf("%s bom=%v: got %q", enc, bom, out)
			}
		}
	}
	// ASCII target loses CJK characters and counts them
	_, lost, _ := Convert([]byte("A中B"), ConvertOptions{From: "utf-8", To: "ascii"})
	if lost != 1 {
		t.Errorf("ascii lost=%d want 1", lost)
	}
	// UTF-8 BOM bytes
	b, _, _ := Convert([]byte("x"), ConvertOptions{From: "auto", To: "utf-8", BOM: true})
	if !bytes.Equal(b, []byte{0xEF, 0xBB, 0xBF, 'x'}) {
		t.Errorf("bom bytes %x", b)
	}
}

const mojiSource = "編碼醫生：這段文字原本是 UTF-8，請確認是否能正確還原。\n設定檔案已經儲存完成。\n"

func TestMojibakeRepair(t *testing.T) {
	r := Analyze("m.md", readTD(t, "mojibake-latin1.md"), Options{})
	if r.Mojibake == nil || r.Mojibake.Via != EncCP1252 || r.Mojibake.Lossy {
		t.Fatalf("latin1 mojibake not detected losslessly: %+v", r.Mojibake)
	}
	if r.Mojibake.Fixed != mojiSource {
		t.Errorf("latin1 repair mismatch:\n got %q\nwant %q", r.Mojibake.Fixed, mojiSource)
	}
	r = Analyze("m.txt", readTD(t, "mojibake-cp950.txt"), Options{})
	if r.Mojibake == nil || r.Mojibake.Via != EncBig5 || !r.Mojibake.Lossy {
		t.Fatalf("cp950 mojibake: %+v", r.Mojibake)
	}
	// best-effort: the ASCII part and a good share of the Han characters survive
	if !strings.Contains(r.Mojibake.Fixed, "UTF-8") || !strings.Contains(r.Mojibake.Fixed, "編碼") {
		t.Errorf("cp950 repair too poor: %q", r.Mojibake.Fixed)
	}
	// correct text must not be flagged
	for _, s := range []string{mojiSource, "Café crème", "日本語のテキストです。", "简体中文的测试"} {
		if m := DetectMojibake(s); m != nil {
			t.Errorf("false positive on %q: %+v", s, m)
		}
	}
}

func TestFixMakesClean(t *testing.T) {
	ents, _ := os.ReadDir(filepath.Join("..", "testdata"))
	for _, e := range ents {
		name := e.Name()
		data := readTD(t, name)
		opt := Options{ForceASCII: true}
		res := Fix(name, data, opt)
		if res.After.FixableCount != 0 {
			t.Errorf("%s: still fixable after fix: %v", name, codesOf(res.After))
		}
		for _, is := range res.After.Issues {
			if is.Severity == "error" && is.Code != "mojibake" {
				t.Errorf("%s: error after fix: %s", name, is.Code)
			}
		}
	}
	// specific byte-level expectations
	res := Fix("no-bom.ps1", readTD(t, "no-bom.ps1"), Options{})
	if !bytes.HasPrefix(res.Data, BOMUTF8) {
		t.Error("ps1 fix should add UTF-8 BOM")
	}
	res = Fix("big5-readme.md", readTD(t, "big5-readme.md"), Options{})
	if !strings.Contains(string(res.Data), "說明文件") || bytes.HasPrefix(res.Data, BOMUTF8) {
		t.Errorf("big5 md fix: %q", res.Data)
	}
	res = Fix("chinese-echo.bat", readTD(t, "chinese-echo.bat"), Options{ForceASCII: true})
	if bytes.ContainsAny(res.Data, "\x80\xff") || strings.Count(string(res.Data), "\r\n") != 4 {
		t.Errorf("bat fix: %q", res.Data)
	}
	res = Fix("mojibake-latin1.md", readTD(t, "mojibake-latin1.md"), Options{})
	if string(res.Data) != mojiSource {
		t.Errorf("mojibake fix: %q", res.Data)
	}
}

func TestEOL(t *testing.T) {
	st := CountEOL("a\r\nb\nc\rd")
	if st.CRLF != 1 || st.LF != 1 || st.CR != 1 || st.Style != "mixed" || st.Lines != 4 {
		t.Errorf("%+v", st)
	}
	if NormalizeEOL("a\r\nb\nc\r", "crlf") != "a\r\nb\r\nc\r\n" {
		t.Error("normalize crlf")
	}
	if NormalizeEOL("a\r\nb\n", "lf") != "a\nb\n" {
		t.Error("normalize lf")
	}
}

func TestNormalizeEncoding(t *testing.T) {
	for in, want := range map[string]string{"CP950": EncBig5, "utf8": EncUTF8, "936": EncGBK, "sjis": EncSJIS, "latin1": EncCP1252} {
		if got, err := NormalizeEncoding(in); err != nil || got != want {
			t.Errorf("%s -> %s %v", in, got, err)
		}
	}
	if _, err := NormalizeEncoding("klingon"); err == nil {
		t.Error("expected error")
	}
}

// Random and adversarial input must never panic and must stay fast.
func TestRobustness(t *testing.T) {
	rng := rand.New(rand.NewSource(1))
	for i := 0; i < 300; i++ {
		b := make([]byte, rng.Intn(600))
		rng.Read(b)
		for _, name := range []string{"x.bat", "x.ps1", "x.md", "x.txt", "x.bin"} {
			res := Fix(name, b, Options{ForceASCII: true, AllowLossy: true})
			_ = res
		}
	}
	// large mojibake-ish input with many gaps
	big := strings.Repeat(string(readTD(t, "mojibake-cp950.txt")), 400)
	start := time.Now()
	Analyze("big.txt", []byte(big), Options{})
	if d := time.Since(start); d > 5*time.Second {
		t.Errorf("large input too slow: %v", d)
	}
}
