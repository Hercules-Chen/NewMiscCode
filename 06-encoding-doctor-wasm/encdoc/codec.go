// Package encdoc is the core of 編碼醫生 (Encoding Doctor): encoding detection,
// conversion, line-ending statistics, mojibake repair and per-file-type policy rules.
// The same package is compiled into the native CLI (cmd/encdoc) and the
// browser WebAssembly module (cmd/wasm).
package encdoc

import (
	"bytes"
	"fmt"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
	"golang.org/x/text/encoding/unicode"
)

// Canonical encoding names used everywhere (CLI flags, JSON, UI dropdown).
const (
	EncASCII   = "ascii"
	EncUTF8    = "utf-8"
	EncUTF16LE = "utf-16le"
	EncUTF16BE = "utf-16be"
	EncBig5    = "big5" // CP950 / Big5 (Go x/text uses the WHATWG Big5 table, a superset of CP950)
	EncGBK     = "gbk"  // decoded with GB18030 (superset of GBK / CP936)
	EncSJIS    = "shift_jis"
	EncCP1252  = "windows-1252"
	EncBinary  = "binary"
)

// Encodings lists the encodings the tool can decode and encode.
var Encodings = []string{EncUTF8, EncBig5, EncGBK, EncSJIS, EncCP1252, EncUTF16LE, EncUTF16BE, EncASCII}

var aliases = map[string]string{
	"utf8": EncUTF8, "utf-8": EncUTF8, "utf-8-bom": EncUTF8, "utf8bom": EncUTF8, "65001": EncUTF8,
	"big5": EncBig5, "cp950": EncBig5, "950": EncBig5, "big-5": EncBig5,
	"gbk": EncGBK, "cp936": EncGBK, "936": EncGBK, "gb2312": EncGBK, "gb18030": EncGBK,
	"shift_jis": EncSJIS, "shift-jis": EncSJIS, "sjis": EncSJIS, "cp932": EncSJIS, "932": EncSJIS,
	"windows-1252": EncCP1252, "cp1252": EncCP1252, "1252": EncCP1252, "latin1": EncCP1252, "latin-1": EncCP1252, "iso-8859-1": EncCP1252,
	"utf-16le": EncUTF16LE, "utf16le": EncUTF16LE, "utf-16": EncUTF16LE, "unicode": EncUTF16LE, "1200": EncUTF16LE,
	"utf-16be": EncUTF16BE, "utf16be": EncUTF16BE, "1201": EncUTF16BE,
	"ascii": EncASCII, "us-ascii": EncASCII, "20127": EncASCII,
}

// NormalizeEncoding maps aliases such as "cp950" or "UTF8" to a canonical name.
func NormalizeEncoding(name string) (string, error) {
	n := strings.ToLower(strings.TrimSpace(name))
	if v, ok := aliases[n]; ok {
		return v, nil
	}
	return "", fmt.Errorf("unknown encoding %q (supported: %s)", name, strings.Join(Encodings, ", "))
}

func xenc(name string) encoding.Encoding {
	switch name {
	case EncBig5:
		return traditionalchinese.Big5
	case EncGBK:
		return simplifiedchinese.GB18030
	case EncSJIS:
		return japanese.ShiftJIS
	case EncUTF16LE:
		return unicode.UTF16(unicode.LittleEndian, unicode.IgnoreBOM)
	case EncUTF16BE:
		return unicode.UTF16(unicode.BigEndian, unicode.IgnoreBOM)
	}
	return nil
}

// BOM byte sequences.
var (
	BOMUTF8    = []byte{0xEF, 0xBB, 0xBF}
	BOMUTF16LE = []byte{0xFF, 0xFE}
	BOMUTF16BE = []byte{0xFE, 0xFF}
)

// SniffBOM returns the BOM type ("utf-8", "utf-16le", "utf-16be" or "") and its length.
func SniffBOM(b []byte) (string, int) {
	switch {
	case bytes.HasPrefix(b, BOMUTF8):
		return EncUTF8, 3
	case bytes.HasPrefix(b, BOMUTF16LE):
		return EncUTF16LE, 2
	case bytes.HasPrefix(b, BOMUTF16BE):
		return EncUTF16BE, 2
	}
	return "", 0
}

// Decode decodes b (without BOM) using the named encoding. invalid counts byte
// sequences that could not be decoded (each becomes U+FFFD in the result).
func Decode(b []byte, enc string) (text string, invalid int, err error) {
	enc, err = NormalizeEncoding(enc)
	if err != nil {
		return "", 0, err
	}
	switch enc {
	case EncUTF8:
		var sb strings.Builder
		sb.Grow(len(b))
		for i := 0; i < len(b); {
			r, n := utf8.DecodeRune(b[i:])
			if r == utf8.RuneError && n <= 1 {
				invalid++
				sb.WriteRune(utf8.RuneError)
				i++
				continue
			}
			sb.WriteRune(r)
			i += n
		}
		return sb.String(), invalid, nil
	case EncASCII:
		var sb strings.Builder
		for _, c := range b {
			if c > 0x7F {
				invalid++
				sb.WriteRune(utf8.RuneError)
			} else {
				sb.WriteByte(c)
			}
		}
		return sb.String(), invalid, nil
	case EncCP1252:
		var sb strings.Builder
		for _, c := range b {
			sb.WriteRune(cp1252Decode(c))
		}
		return sb.String(), 0, nil
	}
	out, err := xenc(enc).NewDecoder().Bytes(b)
	if err != nil {
		return "", 0, err
	}
	s := string(out)
	return s, strings.Count(s, "\uFFFD"), nil
}

// Encode encodes text into the named encoding. Characters that cannot be
// represented are replaced by '?' and counted in lost.
func Encode(text string, enc string) (out []byte, lost int, err error) {
	enc, err = NormalizeEncoding(enc)
	if err != nil {
		return nil, 0, err
	}
	switch enc {
	case EncUTF8:
		return []byte(text), 0, nil
	case EncASCII:
		var buf bytes.Buffer
		for _, r := range text {
			if r < 0x80 {
				buf.WriteByte(byte(r))
			} else {
				buf.WriteByte('?')
				lost++
			}
		}
		return buf.Bytes(), lost, nil
	case EncCP1252:
		var buf bytes.Buffer
		for _, r := range text {
			if c, ok := cp1252Encode(r); ok {
				buf.WriteByte(c)
			} else {
				buf.WriteByte('?')
				lost++
			}
		}
		return buf.Bytes(), lost, nil
	}
	e := xenc(enc).NewEncoder()
	// Fast path: whole string encodes.
	if res, err := e.Bytes([]byte(text)); err == nil {
		return res, 0, nil
	}
	var buf bytes.Buffer
	var tmp [4]byte
	for _, r := range text {
		if r < 0x80 && enc != EncUTF16LE && enc != EncUTF16BE {
			buf.WriteByte(byte(r))
			continue
		}
		n := utf8.EncodeRune(tmp[:], r)
		res, err := e.Bytes(tmp[:n])
		if err != nil || r == utf8.RuneError {
			lost++
			q, _ := e.Bytes([]byte("?"))
			buf.Write(q)
			continue
		}
		buf.Write(res)
	}
	return buf.Bytes(), lost, nil
}

// cp1252 0x80-0x9F. Undefined slots (0x81, 0x8D, 0x8F, 0x90, 0x9D) map to the
// C1 control with the same value (WHATWG behaviour) so the mapping is lossless,
// which is what mojibake repair needs.
var cp1252High = [32]rune{
	0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008D, 0x017D, 0x008F,
	0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x017E, 0x0178,
}

var cp1252Rev = func() map[rune]byte {
	m := map[rune]byte{}
	for i, r := range cp1252High {
		m[r] = byte(0x80 + i)
	}
	return m
}()

func cp1252Decode(c byte) rune {
	if c >= 0x80 && c < 0xA0 {
		return cp1252High[c-0x80]
	}
	return rune(c)
}

func cp1252Encode(r rune) (byte, bool) {
	if r < 0x80 || (r >= 0xA0 && r <= 0xFF) {
		return byte(r), true
	}
	if b, ok := cp1252Rev[r]; ok {
		return b, true
	}
	if r >= 0x80 && r < 0xA0 { // C1 controls that cp1252 defines differently: accept as latin-1
		return byte(r), true
	}
	return 0, false
}

// EncodeWithBOM encodes text and optionally prepends the BOM of the encoding
// (only meaningful for utf-8 / utf-16le / utf-16be).
func EncodeWithBOM(text, enc string, bom bool) ([]byte, int, error) {
	out, lost, err := Encode(text, enc)
	if err != nil || !bom {
		return out, lost, err
	}
	enc, _ = NormalizeEncoding(enc)
	switch enc {
	case EncUTF8:
		out = append(append([]byte{}, BOMUTF8...), out...)
	case EncUTF16LE:
		out = append(append([]byte{}, BOMUTF16LE...), out...)
	case EncUTF16BE:
		out = append(append([]byte{}, BOMUTF16BE...), out...)
	}
	return out, lost, nil
}
