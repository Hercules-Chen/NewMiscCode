// 刻意違規：R3 out 參數（Try* 模式、Deconstruct、extern 不算）
using System.Runtime.InteropServices;

namespace SampleApp.Violations
{
    public class R3_OutParams
    {
        public bool Parse(string s, out int value, out string error) // expect: R3
        {
            value = 0;
            error = "";
            return int.TryParse(s, out value);
        }

        public void Split(string fullName, out string first, out string last) // expect: R3
        {
            var parts = fullName.Split(' ');
            first = parts[0];
            last = parts.Length > 1 ? parts[1] : "";
        }

        // Try* 模式（ignoreTryPattern = true）不報
        public bool TryFind(string key, out string value)
        {
            value = key;
            return true;
        }

        // Deconstruct 是語言規定的 out 形式，不報
        public void Deconstruct(out int x, out int y)
        {
            x = 1;
            y = 2;
        }

        // P/Invoke（extern）不報
        [DllImport("kernel32.dll")]
        private static extern bool QueryPerformanceCounter(out long count);

        // ref 不是 out，不報
        public void Increment(ref int counter) => counter++;

        public int Outer()
        {
            int Helper(out int z) { z = 1; return 2; } // expect: R3
            return Helper(out _);
        }
    }
}
