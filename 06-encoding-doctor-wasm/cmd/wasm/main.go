//go:build js && wasm

// WebAssembly bridge: exposes the encdoc core to JavaScript as globalThis.encdoc.
// Data crosses the boundary as Uint8Array (bytes) and JSON strings (reports).
//
//	encdoc.version                       -> "0.1.0"
//	encdoc.encodings                     -> ["utf-8", "big5", ...]
//	encdoc.policy(name)                  -> "bat" | "ps1" | "utf8-nobom" | "sh" | "text" | ""
//	encdoc.analyze(name, u8, optsJSON)   -> JSON string of Report
//	encdoc.fix(name, u8, optsJSON)       -> {json: FixResult JSON, bytes: Uint8Array}
//	encdoc.decode(u8, encoding)          -> {text, invalid, bom}
//	encdoc.convert(u8, optsJSON)         -> {bytes, lost} | {error}
//	encdoc.zip(names[], u8s[])           -> Uint8Array (zip archive)
package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"syscall/js"
	"time"

	"encdoc/encdoc"
)

func bytesFrom(v js.Value) []byte {
	b := make([]byte, v.Get("length").Int())
	js.CopyBytesToGo(b, v)
	return b
}

func toU8(b []byte) js.Value {
	u := js.Global().Get("Uint8Array").New(len(b))
	js.CopyBytesToJS(u, b)
	return u
}

func opts(args []js.Value, i int) encdoc.Options {
	var o encdoc.Options
	if len(args) > i && args[i].Type() == js.TypeString && args[i].String() != "" {
		_ = json.Unmarshal([]byte(args[i].String()), &o)
	}
	return o
}

func jsonString(v any) string {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
	return buf.String()
}

// guard turns Go panics into a JS {error} object instead of killing the runtime.
func guard(f func(this js.Value, args []js.Value) any) js.Func {
	return js.FuncOf(func(this js.Value, args []js.Value) (ret any) {
		defer func() {
			if r := recover(); r != nil {
				ret = map[string]any{"error": "panic: " + toStr(r)}
			}
		}()
		return f(this, args)
	})
}

func toStr(v any) string {
	if e, ok := v.(error); ok {
		return e.Error()
	}
	if s, ok := v.(string); ok {
		return s
	}
	return "unknown"
}

func main() {
	api := js.Global().Get("Object").New()
	api.Set("version", encdoc.Version)
	encs := js.Global().Get("Array").New()
	for _, e := range encdoc.Encodings {
		encs.Call("push", e)
	}
	api.Set("encodings", encs)

	api.Set("policy", guard(func(_ js.Value, a []js.Value) any {
		return encdoc.PolicyFor(a[0].String())
	}))
	api.Set("analyze", guard(func(_ js.Value, a []js.Value) any {
		r := encdoc.Analyze(a[0].String(), bytesFrom(a[1]), opts(a, 2))
		return jsonString(r)
	}))
	api.Set("fix", guard(func(_ js.Value, a []js.Value) any {
		res := encdoc.Fix(a[0].String(), bytesFrom(a[1]), opts(a, 2))
		return map[string]any{"json": jsonString(res), "bytes": toU8(res.Data)}
	}))
	api.Set("decode", guard(func(_ js.Value, a []js.Value) any {
		data := bytesFrom(a[0])
		enc := "auto"
		if len(a) > 1 && a[1].Type() == js.TypeString {
			enc = a[1].String()
		}
		if enc == "auto" || enc == "" {
			d := encdoc.Detect(data)
			return map[string]any{"text": d.Text, "invalid": d.Invalid, "bom": d.BOM, "encoding": d.Encoding}
		}
		bom, n := encdoc.SniffBOM(data)
		norm, err := encdoc.NormalizeEncoding(enc)
		if err != nil {
			return map[string]any{"error": err.Error()}
		}
		if bom != norm {
			bom, n = "", 0
		}
		text, inv, err := encdoc.Decode(data[n:], norm)
		if err != nil {
			return map[string]any{"error": err.Error()}
		}
		return map[string]any{"text": text, "invalid": inv, "bom": bom, "encoding": norm}
	}))
	api.Set("convert", guard(func(_ js.Value, a []js.Value) any {
		var o encdoc.ConvertOptions
		if len(a) > 1 {
			_ = json.Unmarshal([]byte(a[1].String()), &o)
		}
		out, lost, err := encdoc.Convert(bytesFrom(a[0]), o)
		if err != nil {
			return map[string]any{"error": err.Error()}
		}
		return map[string]any{"bytes": toU8(out), "lost": lost}
	}))
	api.Set("zip", guard(func(_ js.Value, a []js.Value) any {
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)
		n := a[0].Get("length").Int()
		for i := 0; i < n; i++ {
			h := &zip.FileHeader{Name: a[0].Index(i).String(), Method: zip.Deflate, Modified: time.Now()}
			h.Flags |= 0x800 // UTF-8 file names
			w, err := zw.CreateHeader(h)
			if err != nil {
				return map[string]any{"error": err.Error()}
			}
			w.Write(bytesFrom(a[1].Index(i)))
		}
		if err := zw.Close(); err != nil {
			return map[string]any{"error": err.Error()}
		}
		return toU8(buf.Bytes())
	}))
	js.Global().Set("encdoc", api)
	if cb := js.Global().Get("__encdocReady"); cb.Type() == js.TypeFunction {
		cb.Invoke()
	}
	select {}
}
