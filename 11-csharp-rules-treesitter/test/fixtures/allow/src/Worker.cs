using System.Threading.Tasks;

namespace Fixture
{
    public class Worker
    {
        [Fact]
        public void AttributeAllowed() => Task.FromResult(1).Wait();

        public int NotAllowed() => GetAsync().Result;

        public bool TryRead(out int v) { v = 1; return true; }

        private static Task<int> GetAsync() => Task.FromResult(1);
    }

    public class WorkerTests
    {
        public int ClassAllowed() => GetAsync().GetAwaiter().GetResult();

        private static Task<int> GetAsync() => Task.FromResult(1);
    }
}
