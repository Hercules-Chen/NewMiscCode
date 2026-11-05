package encdoc

// Readability scoring. Each decoded candidate text gets a quality in roughly
// [-1, 1]: frequent Han characters, kana and CJK punctuation raise it; PUA,
// half-width katakana, C1 controls and U+FFFD lower it. Big5 bytes decoded as
// GBK (or the other way round) are almost always *valid* but produce rare
// characters, so frequency is what separates the candidates.

const commonTrad = "的一是不了人我在有他這中大來上個國到說們為子和你地出道也時年得就那要下以生會自著去之過家學對可她裡後小麼心多天而能好都然沒日於起還發成事只作當想看文無開手十用主行方又如前所本見經頭面公同三已老從動兩長知民樣現分將外但身些與高意進把法此實回二理美點月明其種聲全工己話兒者向情部正名定女問力機給等幾很業最間新什打便位因重被走電四第門相次東政海口使教西再平真聽世氣信北少關並內加化由卻代軍產入先山五太水萬市眼體別處總才場師書比住員九笑性通目華報立馬命張活難神數件安表原車白應路期叫死常提感金何更反合放做系計或司利受光王果親界及今京務制解各任至清物台設保程資料檔案錯誤執行版本編碼測試統式視窗繁體字元請輸入確取消選擇顯示讀寫啟結束失敗功警告明網頁伺服器指令腳路徑目錄儲存完已經換轉亂醫診斷修復檢查規則需要支援使用者電腦軟硬碟記憶歡迎謝您們嗎吧呢啊喔"

const commonSimp = "的一是不了人我在有他这中大来上个国到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工己话儿者向情部正名定女问力机给等几很业最间新什打便位因重被走电四第门相次东政海口使教西再平真听世气信北少关并内加化由却代军产入先山五太水万市眼体别处总才场师书比住员九笑性通目华报立马命张活难神数件安表原车白应路期叫死常提感金何更反合放做系计或司利受光王果亲界及今京务制解各任至清物台设保程资料档案错误执行版本编码测试统序窗口简体字符请输入确取消选择显示读写启结束失败功警告明网页服务器指令脚路径目录储存完已经换转乱医诊断修复检查规则需要支持使用者电脑软硬盘记忆欢迎谢您吗吧呢啊哦"

const commonJaKanji = "日本人年大中出時行見月分後前生間上東者自事会社語学私何今思言手気物国子来"

var (
	setTrad = map[rune]bool{}
	setSimp = map[rune]bool{}
	setJa   = map[rune]bool{}
	rank    = map[rune]float64{}
)

// rankBonus favours the most frequent characters (earlier in the lists).
func rankBonus(r rune) float64 { return rank[r] }

func init() {
	tr, sr := []rune(commonTrad), []rune(commonSimp)
	for i, r := range tr {
		setTrad[r] = true
		if _, ok := rank[r]; !ok {
			rank[r] = 0.5 * (1 - float64(i)/float64(len(tr)))
		}
	}
	for i, r := range sr {
		setSimp[r] = true
		if _, ok := rank[r]; !ok {
			rank[r] = 0.5 * (1 - float64(i)/float64(len(sr)))
		}
	}
	for _, r := range commonJaKanji {
		setJa[r] = true
	}
	for r := range setTrad {
		if setSimp[r] {
			setJa[r] = true
		}
	}
}

// Language hints used by Quality.
const (
	langAny  = "any"
	langHant = "zh-hant"
	langHans = "zh-hans"
	langJa   = "ja"
	langLat  = "latin"
)

func isCJKPunct(r rune) bool {
	return (r >= 0x3000 && r <= 0x303F) || (r >= 0xFF01 && r <= 0xFF5E) || r == 0x2014 || r == 0x2026 || (r >= 0x2018 && r <= 0x201D) || r == 0x00B7
}

func isKana(r rune) bool { return r >= 0x3040 && r <= 0x30FF }

// runeWeight scores one non-ASCII rune for a language hint.
func runeWeight(r rune, lang string) float64 {
	switch {
	case r == 0xFFFD:
		return -1
	case r >= 0x80 && r < 0xA0: // C1 controls
		return -1
	case r >= 0xE000 && r <= 0xF8FF: // private use (EUDC)
		return -1
	case r >= 0xFF61 && r <= 0xFF9F: // half-width katakana
		if lang == langJa {
			return -0.2
		}
		return -0.7
	case isCJKPunct(r):
		return 1
	case isKana(r):
		switch lang {
		case langJa, langAny:
			return 1
		}
		return -0.3
	case r >= 0x4E00 && r <= 0x9FFF:
		t, s, j := setTrad[r], setSimp[r], setJa[r]
		switch lang {
		case langHant:
			if t {
				return 1
			}
			if s {
				return 0.3
			}
		case langHans:
			if s {
				return 1
			}
			if t {
				return 0.3
			}
		case langJa:
			if j {
				return 1
			}
			if t || s {
				return 0.6
			}
		default:
			if t || s || j {
				return 1
			}
		}
		return 0.1
	case (r >= 0x3400 && r <= 0x4DBF) || (r >= 0xF900 && r <= 0xFAFF) || r > 0xFFFF:
		return -0.5
	case r >= 0xC0 && r <= 0xFF:
		if lang == langLat {
			return 0.7
		}
		return 0
	case (r >= 0x0370 && r <= 0x04FF) || (r >= 0x2500 && r <= 0x25FF):
		return -0.3
	}
	if lang == langLat {
		return 0.3
	}
	return 0
}

// Quality returns the mean weight of the non-ASCII runes of s (1 if s is pure
// ASCII) and the number of non-ASCII runes.
func Quality(s, lang string) (float64, int) {
	sum, n := 0.0, 0
	for _, r := range s {
		if r < 0x80 {
			if r == 0 {
				sum -= 0.5
				n++
			}
			continue
		}
		sum += runeWeight(r, lang)
		n++
	}
	if n == 0 {
		return 1, 0
	}
	return sum / float64(n), n
}

func langFor(enc string) string {
	switch enc {
	case EncBig5:
		return langHant
	case EncGBK:
		return langHans
	case EncSJIS:
		return langJa
	case EncCP1252:
		return langLat
	}
	return langAny
}
