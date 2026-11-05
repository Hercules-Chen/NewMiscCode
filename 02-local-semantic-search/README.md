# 02 · Local Semantic Search（本機語意 + 關鍵字混合搜尋）

Fully local hybrid search (SQLite FTS5/BM25 + sqlite-vec KNN, fused with RRF) over zh-TW / English
Markdown and HTML notes, with a local ONNX embedding model (`Xenova/multilingual-e5-small`, int8)
run on CPU by `@huggingface/transformers`. CLI + local web UI (zh-TW / en).

**Full documentation: [README.html](README.html)** (open in a browser; tabbed sections incl. step-by-step verification guide).

```bash
npm ci
npm run fetch-model        # or: npm run fetch-model:npm  (when huggingface.co is blocked)
npm run index:preview      # dry-run, writes nothing
npm run index
npm run search -- 欄位加密連線失敗
npm run serve              # http://127.0.0.1:8787/
npm test
```

Windows: double-click `index.bat` / `serve.bat` (or `lss.bat <args>`). Pin Node 22 with Volta; run `npm rebuild` after changing Node versions.
Model weights (~135 MB) are not committed; `models/` is git-ignored.
