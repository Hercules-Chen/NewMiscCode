# WSL2 與 Docker Desktop 筆記

- WSL2 的檔案放在 Linux 檔案系統（\\wsl$\Ubuntu\home）效能遠比掛載 C 槽好。
- Docker Desktop 記憶體吃太多：在 `%UserProfile%\.wslconfig` 設定 `memory=4GB`。
- 公司 Proxy：在 Docker Desktop 設定 HTTP_PROXY，容器內 apt 與 npm 才能連外。
- `wsl --shutdown` 可以釋放 vmmem 佔用的記憶體。
