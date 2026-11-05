// 內嵌抑制註解示範
using System.Net.Http;
using System.Threading.Tasks;

namespace SampleApp.Violations
{
    public class Suppressed
    {
        public string Legacy(HttpClient http)
        {
            // csrules-disable-next-line R1 -- 舊版同步 API，下個版本移除
            return http.GetStringAsync("https://example.com").Result;
        }

        public void Legacy2()
        {
            try { Legacy(null!); } catch { } // csrules-disable-line R5
        }

        public string WrongId(HttpClient http)
        {
            // csrules-disable-next-line R3  (抑制的是 R3，所以 R1 仍會報)
            return http.GetStringAsync("https://example.com").Result; // expect: R1
        }

        public string AllRules(HttpClient http)
        {
            // csrules-disable-next-line
            return http.GetStringAsync("https://example.com").Result;
        }
    }
}
