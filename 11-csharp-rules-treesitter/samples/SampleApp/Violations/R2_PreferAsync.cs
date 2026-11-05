// 刻意違規：R2 async void 與公開方法中的同步 I/O
using System;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using Microsoft.Data.SqlClient;

namespace SampleApp.Violations
{
    public class R2_PreferAsync
    {
        public async void FireAndForget() // expect: R2
        {
            await Task.Delay(10);
        }

        // 事件處理常式（object sender, EventArgs e）允許 async void
        private async void OnClick(object sender, EventArgs e)
        {
            await Task.Delay(10);
        }

        public string LoadConfig(string path)
        {
            return File.ReadAllText(path); // expect: R2
        }

        public void SaveConfig(string path, string json)
        {
            System.IO.File.WriteAllText(path, json); // expect: R2
        }

        public int CountRows(SqlConnection conn)
        {
            using var cmd = new SqlCommand("SELECT COUNT(*) FROM Orders", conn);
            using var reader = cmd.ExecuteReader(); // expect: R2
            var n = 0;
            while (reader.Read()) n++;
            return n;
        }

        public HttpResponseMessage Call(HttpClient httpClient, HttpRequestMessage req)
        {
            return httpClient.Send(req); // expect: R2
        }

        // private 方法不在 R2 同步 I/O 範圍（publicOnly = true）
        private string LoadPrivate(string path) => File.ReadAllText(path);

        public void Process()
        {
            async void Local() { await Task.Delay(1); } // expect: R2
            Local();
        }
    }
}
