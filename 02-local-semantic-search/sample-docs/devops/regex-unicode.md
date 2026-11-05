# Unicode-aware regular expressions in JavaScript

Use the `u` flag and Unicode property escapes:

- `/\p{Script=Han}/u` matches a Chinese character (both Traditional and Simplified).
- `/[\p{L}\p{N}]+/gu` matches words in any language.
- `Array.from(str)` splits by code point, so emoji and supplementary CJK characters are not broken.

Normalise full-width characters with `str.normalize('NFKC')` before comparing, e.g. `ＡＢＣ１２３` becomes `ABC123`.
