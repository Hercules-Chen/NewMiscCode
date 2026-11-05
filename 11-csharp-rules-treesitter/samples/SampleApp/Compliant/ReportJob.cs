// 合規範例（續）：記錄日誌的多種寫法
using System;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace SampleApp.Compliant
{
    public static class Log
    {
        public static void Error(Exception ex, string message) => Console.Error.WriteLine(message + ex);
    }

    public class ReportJob
    {
        private readonly ILogger _log;

        public ReportJob(ILogger log) => _log = log;

        public async Task RunAsync()
        {
            try
            {
                await Task.Yield();
            }
            catch (InvalidOperationException ex)
            {
                _log.LogCritical(ex, "report failed");
            }
            catch (Exception ex)
            {
                Log.Error(ex, "unexpected");
            }
        }

        public void RunSync()
        {
            try
            {
                DoWork();
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex);
            }
        }

        public int Compute() => DoWork() ? 1 : 0;

        private bool DoWork() => true;
    }
}
