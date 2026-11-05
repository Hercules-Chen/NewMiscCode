// 刻意違規：R4 方法內 new HttpClient()、async 方法中 Thread.Sleep
using System;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace SampleApp.Violations
{
    public class R4_ResourceMisuse
    {
        // static 共用執行個體：允許
        private static readonly HttpClient Shared = new HttpClient();

        public async Task<string> FetchAsync(string url)
        {
            using var client = new HttpClient(); // expect: R4
            return await client.GetStringAsync(url);
        }

        public async Task<string> FetchTargetTypedAsync(string url)
        {
            HttpClient client = new(); // expect: R4
            return await client.GetStringAsync(url);
        }

        public async Task RetryAsync()
        {
            Thread.Sleep(1000); // expect: R4
            await Task.Delay(1);
        }

        // 同步方法中的 Thread.Sleep 不在 R4 範圍
        public void Poll()
        {
            Thread.Sleep(100);
        }

        public Func<Task> MakeWorker() => async () =>
        {
            System.Threading.Thread.Sleep(50); // expect: R4
            await Task.CompletedTask;
        };

        public Task<string> UseShared(string url) => Shared.GetStringAsync(url);
    }
}
