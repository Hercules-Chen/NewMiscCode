// 刻意違規：R5 catch 吞掉例外
using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace SampleApp.Violations
{
    public class R5_SwallowedExceptions
    {
        private readonly ILogger<R5_SwallowedExceptions> _logger;

        public R5_SwallowedExceptions(ILogger<R5_SwallowedExceptions> logger) => _logger = logger;

        public void Empty()
        {
            try { Work(); }
            catch (Exception) { } // expect: R5
        }

        public int ReturnDefault()
        {
            try { return Work(); }
            catch (InvalidOperationException ex) // expect: R5
            {
                Console.WriteLine("failed: " + ex.Message); // Console.WriteLine 不算記錄日誌
                return -1;
            }
        }

        public void BareCatch()
        {
            try
            {
                Work();
            }
            catch // expect: R5
            {
            }
        }

        // 以下為合規寫法（不應報）
        public void Logged()
        {
            try { Work(); }
            catch (Exception ex) { _logger.LogError(ex, "Work failed"); }
        }

        public void Rethrow()
        {
            try { Work(); }
            catch (IOException) { Cleanup(); throw; }
        }

        public void Wrapped()
        {
            try { Work(); }
            catch (Exception ex) { throw new InvalidOperationException("wrapped", ex); }
        }

        public async Task CancelAsync(CancellationToken ct)
        {
            try { await Task.Delay(1000, ct); }
            catch (OperationCanceledException) { } // ignoreExceptionTypes
        }

        private int Work() => 1;
        private void Cleanup() { }
    }
}
