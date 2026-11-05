package encdoc

import (
	"math"
	"sort"
	"strings"
	"unicode/utf8"
)

// Candidate is one possible encoding with its score.
type Candidate struct {
	Encoding   string  `json:"encoding"`
	Confidence float64 `json:"confidence"`
	Quality    float64 `json:"quality"`
	Invalid    int     `json:"invalid"`
	Sample     string  `json:"sample"`
}

// Detection is the result of Detect.
type Detection struct {
	Encoding   string      `json:"encoding"`
	Confidence float64     `json:"confidence"`
	BOM        string      `json:"bom"`
	Invalid    int         `json:"invalid"`
	Candidates []Candidate `json:"candidates"`
	Text       string      `json:"-"`
}

const sniffLimit = 1 << 20 // score at most 1 MiB

func round3(f float64) float64 { return math.Round(f*1000) / 1000 }

func isASCII(b []byte) bool {
	for _, c := range b {
		if c >= 0x80 {
			return false
		}
	}
	return true
}

// utf16Guess looks for the zero-byte pattern of BOM-less UTF-16 text.
func utf16Guess(b []byte) string {
	n := len(b)
	if n > 4096 {
		n = 4096
	}
	if n < 4 {
		return ""
	}
	even, odd := 0, 0
	for i := 0; i+1 < n; i += 2 {
		if b[i] == 0 {
			even++
		}
		if b[i+1] == 0 {
			odd++
		}
	}
	pairs := n / 2
	switch {
	case float64(odd) > 0.4*float64(pairs) && float64(even) < 0.05*float64(pairs):
		return EncUTF16LE
	case float64(even) > 0.4*float64(pairs) && float64(odd) < 0.05*float64(pairs):
		return EncUTF16BE
	}
	return ""
}

// LooksBinary reports whether b looks like a non-text file.
func LooksBinary(b []byte) bool {
	n := len(b)
	if n > 8192 {
		n = 8192
	}
	if n == 0 {
		return false
	}
	nul, ctl := 0, 0
	for _, c := range b[:n] {
		if c == 0 {
			nul++
		} else if c < 0x20 && c != '\t' && c != '\n' && c != '\r' && c != '\f' && c != '\v' && c != 0x1b {
			ctl++
		}
	}
	return float64(nul) > 0.01*float64(n) || float64(ctl) > 0.1*float64(n)
}

func sample(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return string(r[:max])
}

// firstNonASCIIContext returns a short sample around the first non-ASCII rune.
func firstNonASCIIContext(s string) string {
	idx := strings.IndexFunc(s, func(r rune) bool { return r >= 0x80 })
	if idx < 0 {
		return sample(s, 40)
	}
	start := idx - 20
	if start < 0 {
		start = 0
	}
	for start > 0 && !utf8.RuneStart(s[start]) {
		start--
	}
	return strings.ReplaceAll(strings.ReplaceAll(sample(s[start:], 40), "\r", ""), "\n", " ")
}

// Detect guesses the encoding of b.
func Detect(b []byte) Detection {
	if bom, n := SniffBOM(b); bom != "" {
		text, inv, _ := Decode(b[n:], bom)
		return Detection{Encoding: bom, Confidence: 1, BOM: bom, Invalid: inv, Text: text,
			Candidates: []Candidate{{Encoding: bom, Confidence: 1, Quality: 1, Invalid: inv, Sample: firstNonASCIIContext(text)}}}
	}
	if len(b) == 0 || isASCII(b) {
		if g := utf16Guess(b); g != "" {
			text, inv, _ := Decode(b, g)
			return Detection{Encoding: g, Confidence: 0.8, Invalid: inv, Text: text,
				Candidates: []Candidate{{Encoding: g, Confidence: 0.8, Quality: 1, Sample: firstNonASCIIContext(text)}}}
		}
		return Detection{Encoding: EncASCII, Confidence: 1, Text: string(b),
			Candidates: []Candidate{{Encoding: EncASCII, Confidence: 1, Quality: 1}}}
	}
	if g := utf16Guess(b); g != "" {
		text, inv, _ := Decode(b, g)
		return Detection{Encoding: g, Confidence: 0.8, Invalid: inv, Text: text,
			Candidates: []Candidate{{Encoding: g, Confidence: 0.8, Quality: 1, Sample: firstNonASCIIContext(text)}}}
	}
	if LooksBinary(b) {
		return Detection{Encoding: EncBinary, Confidence: 0.9}
	}
	if utf8.Valid(b) {
		text := string(b)
		q, _ := Quality(text, langAny)
		return Detection{Encoding: EncUTF8, Confidence: 0.99, Text: text,
			Candidates: []Candidate{{Encoding: EncUTF8, Confidence: 0.99, Quality: round3(q), Sample: firstNonASCIIContext(text)}}}
	}
	return scoreLegacy(b)
}

// scoreLegacy decodes b with every candidate and ranks by readability.
func scoreLegacy(b []byte) Detection {
	probe := b
	if len(probe) > sniffLimit {
		probe = probe[:sniffLimit]
	}
	type res struct {
		enc   string
		score float64
		q     float64
		inv   int
		text  string
	}
	var rs []res
	for _, enc := range []string{EncUTF8, EncBig5, EncGBK, EncSJIS, EncCP1252} {
		text, inv, err := Decode(probe, enc)
		if err != nil {
			continue
		}
		q, n := Quality(text, langFor(enc))
		score := q
		if n > 0 {
			// invalid sequences already weigh -1 inside Quality (U+FFFD); add extra penalty
			score -= 2 * float64(inv) / float64(n)
		}
		if enc == EncCP1252 {
			score -= 0.05 // prefer a CJK reading when they tie
		}
		rs = append(rs, res{enc, score, q, inv, text})
	}
	sort.SliceStable(rs, func(i, j int) bool { return rs[i].score > rs[j].score })
	// softmax over scores -> confidence
	const k = 8.0
	sum := 0.0
	ex := make([]float64, len(rs))
	for i, r := range rs {
		ex[i] = math.Exp(k * r.score)
		sum += ex[i]
	}
	det := Detection{}
	for i, r := range rs {
		conf := ex[i] / sum
		if i == 0 {
			// a winner with a poor absolute score is still uncertain
			conf *= math.Max(0.05, math.Min(1, r.score))
		}
		det.Candidates = append(det.Candidates, Candidate{Encoding: r.enc, Confidence: round3(conf), Quality: round3(r.q), Invalid: r.inv, Sample: firstNonASCIIContext(r.text)})
	}
	best := rs[0]
	det.Encoding = best.enc
	det.Confidence = det.Candidates[0].Confidence
	if len(b) > len(probe) { // decode the full file with the winner
		det.Text, det.Invalid, _ = Decode(b, best.enc)
	} else {
		det.Text, det.Invalid = best.text, best.inv
	}
	return det
}
