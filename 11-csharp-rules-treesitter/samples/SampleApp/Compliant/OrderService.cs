// 合規範例：全部規則都不應該報任何問題（用來證明沒有誤報）
using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;

namespace SampleApp.Compliant
{
    public sealed class ValidationResult
    {
        public bool Result { get; set; }
        public void Wait() { }
    }

    public class OrderService
    {
        private static readonly HttpClient s_http = new HttpClient();
        private readonly IHttpClientFactory _factory;
        private readonly ILogger<OrderService> _logger;
        private readonly object _gate = new object();

        public OrderService(IHttpClientFactory factory, ILogger<OrderService> logger)
        {
            _factory = factory;
            _logger = logger;
        }

        // R1：await 取代 .Result；非 Task 物件的 .Result / .Wait() 不報
        public async Task<string> GetPageAsync(string url)
        {
            var client = _factory.CreateClient("orders");
            var page = await client.GetStringAsync(url).ConfigureAwait(false);
            var validation = new ValidationResult();
            validation.Result = page.Length > 0;
            validation.Wait();
            var r = await CheckAsync();
            return r.Result ? page : "";
        }

        public void WaitOnMonitor()
        {
            lock (_gate) { Monitor.Wait(_gate, 10); }
        }

        // R2：async Task；事件處理常式可用 async void；使用 *Async I/O
        public async Task SaveAsync(string path, string text)
        {
            await File.WriteAllTextAsync(path, text);
        }

        public async void OnTimerElapsed(object sender, EventArgs e)
        {
            await SaveAsync("tick.txt", DateTime.Now.ToString("O"));
        }

        public async Task<int> CountRowsAsync(SqlConnection conn, CancellationToken ct)
        {
            await using var cmd = new SqlCommand("SELECT COUNT(*) FROM Orders", conn);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            var n = 0;
            while (await reader.ReadAsync(ct)) n++;
            return n;
        }

        // R3：回傳 tuple，Try* 模式允許 out
        public (bool Ok, int Value, string Error) Parse(string s)
            => int.TryParse(s, out var v) ? (true, v, "") : (false, 0, "not a number");

        public bool TryGetCached(string key, out string? value)
        {
            value = null;
            return false;
        }

        // R4：同步方法中的 Thread.Sleep、static HttpClient；async 中使用 Task.Delay
        public void Throttle() => Thread.Sleep(5);

        public async Task RetryAsync(Func<Task> action)
        {
            for (var i = 0; i < 3; i++)
            {
                try
                {
                    await action();
                    return;
                }
                catch (HttpRequestException ex)
                {
                    _logger.LogWarning(ex, "retry {Attempt}", i);
                    await Task.Delay(100 * (i + 1));
                }
            }
        }

        public Task<string> GetSharedAsync(string url) => s_http.GetStringAsync(url);

        // R5：記錄或重拋
        public IReadOnlyList<string> ReadLinesSafe(string path)
        {
            try
            {
                return LoadLines(path);
            }
            catch (IOException ex)
            {
                _logger.LogError(ex, "讀取 {Path} 失敗", path);
                return Array.Empty<string>();
            }
            catch (UnauthorizedAccessException)
            {
                throw;
            }
        }

        public string Describe(object o) => o switch
        {
            null => throw new ArgumentNullException(nameof(o)),
            _ => o.ToString() ?? "",
        };

        // private 方法不在 R2 同步 I/O 範圍
        private static string[] LoadLines(string path) => File.ReadAllLines(path);

        private Task<ValidationResult> CheckAsync() => Task.FromResult(new ValidationResult());
    }
}
