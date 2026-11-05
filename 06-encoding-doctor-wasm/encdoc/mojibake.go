package encdoc

import (
	"math"
	"unicode/utf8"
)

// Mojibake describes text that looks like UTF-8 bytes that were decoded with
// the wrong codec ("Via") and saved again, plus the reverse-transformed text.
type Mojibake struct {
	Kind          string  `json:"kind"` // e.g. "utf8-as-big5"
	Via           string  `json:"via"`
	Lossy         bool    `json:"lossy"`
	Lost          int     `json:"lost"` // characters that could not be restored
	QualityBefore float64 `json:"qualityBefore"`
	QualityAfter  float64 `json:"qualityAfter"`
	Sample        string  `json:"sample"`
	Fixed         string  `json:"-"`
}

// maxGaps bounds the byte-pair search in reconstructGaps (cost ~ gaps x 8192 decodes).
const maxGaps = 400

// MojibakeVias are the wrong codecs tried in reverse.
var MojibakeVias = []string{EncCP1252, EncBig5, EncGBK, EncSJIS}

// DetectMojibake tries to reverse "UTF-8 decoded as X" for each X and returns
// the best repair if it is clearly more readable than the input.
func DetectMojibake(text string) *Mojibake {
	before, n := Quality(text, langAny)
	if n == 0 || before > 0.85 {
		return nil
	}
	var best *Mojibake
	for _, via := range MojibakeVias {
		raw, lost, err := Encode(text, via)
		if err != nil || float64(lost) > 0.5*float64(n) {
			continue
		}
		if lost > 0 && lost <= maxGaps && via != EncCP1252 {
			raw = reconstructGaps(text, via)
		}
		fixed, invalid, _ := Decode(raw, EncUTF8)
		multi := 0
		for _, r := range fixed {
			if r >= 0x80 && r != 0xFFFD {
				multi++
			}
		}
		if multi == 0 {
			continue
		}
		after, n2 := Quality(fixed, langAny)
		if n2 > 0 && invalid > 0 {
			// lossy repairs must still be mostly intact
			if float64(invalid) > 0.35*float64(n2) {
				continue
			}
		}
		if after-before < 0.35 || after < 0.4 {
			continue
		}
		m := &Mojibake{Kind: "utf8-as-" + via, Via: via, Lost: lost + invalid, Lossy: lost+invalid > 0,
			QualityBefore: round3(before), QualityAfter: round3(after), Fixed: fixed}
		m.Sample = firstNonASCIIContext(fixed)
		if best == nil || after-float64(m.Lost)*0.01 > best.QualityAfter-float64(best.Lost)*0.01 {
			best = m
		}
	}
	return best
}

// reconstructGaps re-encodes text with via; every U+FFFD (a pair of bytes the
// wrong decoder destroyed) becomes a 2-byte gap that is filled with the byte
// pair giving the most frequent valid UTF-8 character. Best effort: the result
// is always reported as lossy.
func reconstructGaps(text, via string) []byte {
	var buf []byte
	var gaps []int
	for _, r := range text {
		if r == 0xFFFD {
			gaps = append(gaps, len(buf))
			buf = append(buf, 0, 0)
			continue
		}
		b, _, _ := Encode(string(r), via)
		buf = append(buf, b...)
	}
	for pass := 0; pass < 3; pass++ {
		for _, g := range gaps {
			fillGap(buf, g)
		}
	}
	return buf
}

func fillGap(buf []byte, g int) {
	{
		lo, hi := g-3, g+5
		if lo < 0 {
			lo = 0
		}
		if hi > len(buf) {
			hi = len(buf)
		}
		bestScore, bl, bt := -1e9, byte(0), byte(0)
		for l := 0x80; l <= 0xFF; l++ {
			for t := 0x80; t <= 0xBF; t++ {
				buf[g], buf[g+1] = byte(l), byte(t)
				sc := gapScore(buf[lo:hi], g-lo, langHant)
				if sc > bestScore {
					bestScore, bl, bt = sc, byte(l), byte(t)
				}
			}
		}
		buf[g], buf[g+1] = bl, bt
	}
}

// gapScore decodes the window w (gap at offset g) and scores all its runes,
// so a fill that breaks a neighbouring character loses.
func gapScore(w []byte, g int, lang string) float64 {
	sc := 0.0
	for i := 0; i < len(w); {
		r, n := utf8.DecodeRune(w[i:])
		{
			if r == utf8.RuneError && n <= 1 {
				sc -= 2
			} else if r >= 0x4E00 && r <= 0x9FFF {
				sc += runeWeight(r, lang) + rankBonus(r)
			} else if r >= 0x80 && r < 0x800 {
				sc -= 1 // Latin/Greek/Cyrillic are unlikely inside CJK mojibake
			} else if r >= 0x80 {
				sc += math.Min(0.2, runeWeight(r, lang))
			} else if r == 0 {
				sc -= 0.5
			}
		}
		i += n
	}
	return sc
}
