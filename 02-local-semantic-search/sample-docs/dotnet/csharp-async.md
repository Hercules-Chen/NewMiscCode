# C# async/await 常見陷阱

## 死結（Deadlock）

在 WinForms / WPF / 舊版 ASP.NET 的 UI 執行緒上呼叫 `task.Result` 或 `task.Wait()`，
而被等待的方法內部 `await` 又想回到同一個 SynchronizationContext，就會互相等待卡死。

解法：一路 async 到底（async all the way），程式庫內部使用 `ConfigureAwait(false)`。

## async void

只用在事件處理常式。async void 丟出的例外無法被呼叫端 try/catch 捕捉，會直接讓行程崩潰。

## 平行執行

```csharp
var tasks = urls.Select(u => http.GetStringAsync(u));
string[] pages = await Task.WhenAll(tasks);
```

需要限制同時數量時用 `SemaphoreSlim` 或 .NET 6 的 `Parallel.ForEachAsync`。

## 取消

傳遞 `CancellationToken`，長時間迴圈內呼叫 `token.ThrowIfCancellationRequested()`。
