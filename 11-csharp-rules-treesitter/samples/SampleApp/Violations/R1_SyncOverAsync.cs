// 刻意違規：R1 同步等待非同步（每個違規行尾都標了 expect，測試會逐行比對）
using System.Net.Http;
using System.Threading.Tasks;

namespace SampleApp.Violations
{
    public class R1_SyncOverAsync
    {
        private readonly HttpClient _http;
        private Task<string> _pendingTask = Task.FromResult("x");

        public R1_SyncOverAsync(HttpClient http) => _http = http;

        public string GetPage(string url)
        {
            return _http.GetStringAsync(url).GetAwaiter().GetResult(); // expect: R1
        }

        public string GetPageResult(string url)
        {
            var page = _http.GetStringAsync(url).Result; // expect: R1
            return page;
        }

        public int Compute()
        {
            Task<int> work = ComputeAsync();
            work.Wait(); // expect: R1
            return work.Result; // expect: R1
        }

        public void WaitForAll()
        {
            var t1 = ComputeAsync();
            var t2 = Task.Run(() => 2);
            Task.WaitAll(t1, t2); // expect: R1
            System.Console.WriteLine(t1.Result + t2.Result); // expect: R1, R1
        }

        public string Pending() => _pendingTask.Result; // expect: R1

        public int Multiline()
        {
            return ComputeAsync() // expect: R1
                .GetAwaiter()
                .GetResult();
        }

        private static Task<int> ComputeAsync() => Task.FromResult(42);
    }
}
