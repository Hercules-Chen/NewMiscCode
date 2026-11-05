// Startup 允許 sync-over-async（R1 allow.paths = **/Startup.cs、allow.classes = Startup）
using System.Threading.Tasks;

namespace SampleApp
{
    public class Startup
    {
        public void ConfigureServices(object services)
        {
            var settings = LoadSettingsAsync().GetAwaiter().GetResult();
            System.Console.WriteLine(settings);
        }

        private static Task<string> LoadSettingsAsync() => Task.FromResult("{}");
    }
}
