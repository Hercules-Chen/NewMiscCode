package encdoc

import "strings"

// EOLStats counts line terminators.
type EOLStats struct {
	CRLF  int    `json:"crlf"`
	LF    int    `json:"lf"`
	CR    int    `json:"cr"`
	Style string `json:"style"` // none | crlf | lf | cr | mixed
	Lines int    `json:"lines"`
}

// CountEOL counts CRLF, lone LF and lone CR in s.
func CountEOL(s string) EOLStats {
	var st EOLStats
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '\r':
			if i+1 < len(s) && s[i+1] == '\n' {
				st.CRLF++
				i++
			} else {
				st.CR++
			}
		case '\n':
			st.LF++
		}
	}
	kinds := 0
	for _, c := range []int{st.CRLF, st.LF, st.CR} {
		if c > 0 {
			kinds++
		}
	}
	switch {
	case kinds == 0:
		st.Style = "none"
	case kinds > 1:
		st.Style = "mixed"
	case st.CRLF > 0:
		st.Style = "crlf"
	case st.LF > 0:
		st.Style = "lf"
	default:
		st.Style = "cr"
	}
	st.Lines = st.CRLF + st.LF + st.CR
	if len(s) > 0 && !strings.HasSuffix(s, "\n") && !strings.HasSuffix(s, "\r") {
		st.Lines++
	}
	return st
}

// Dominant returns "crlf" or "lf" (the more frequent; ties prefer crlf).
func (st EOLStats) Dominant() string {
	if st.CRLF >= st.LF && st.CRLF > 0 {
		return "crlf"
	}
	if st.LF == 0 && st.CRLF == 0 && st.CR > 0 {
		return "crlf"
	}
	return "lf"
}

// NormalizeEOL converts every line ending in s to eol ("crlf", "lf" or "cr").
func NormalizeEOL(s, eol string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	switch eol {
	case "crlf":
		return strings.ReplaceAll(s, "\n", "\r\n")
	case "cr":
		return strings.ReplaceAll(s, "\n", "\r")
	}
	return s
}
