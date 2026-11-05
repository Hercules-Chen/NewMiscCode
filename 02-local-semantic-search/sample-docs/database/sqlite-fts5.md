# SQLite FTS5 cheat sheet

FTS5 is SQLite's full-text search extension.

## Tokenizers

- `unicode61` (default): splits on Unicode separators; CJK text is not segmented into words.
- `trigram`: indexes every 3-character sequence; supports substring LIKE queries but cannot match terms shorter than 3 characters.
- `porter`: English stemming wrapper.

## Ranking

`bm25(fts_table, w1, w2, ...)` returns a score where **lower is better**; column weights let titles count more than body text.

```sql
SELECT rowid, bm25(docs, 5.0, 1.0) AS score FROM docs WHERE docs MATCH 'sqlite OR fts5' ORDER BY score LIMIT 10;
```

Use `snippet()` or `highlight()` for result excerpts.
