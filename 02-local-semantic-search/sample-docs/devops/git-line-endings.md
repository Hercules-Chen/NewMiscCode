# Git line endings on Windows

`core.autocrlf=true` converts LF to CRLF on checkout. Prefer a `.gitattributes` file so every clone behaves the same:

```
* text=auto eol=lf
*.bat text eol=crlf
*.ps1 text eol=crlf
*.png binary
```

Batch files with LF-only endings can misbehave in cmd.exe (labels and `goto` break), so keep them CRLF.
