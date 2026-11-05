// 單元測試專案：R1 允許 .Result / .GetAwaiter().GetResult()（allow.paths = **/*.Tests/**）
using System.Threading.Tasks;
using Xunit;

namespace SampleApp.Tests
{
    public class OrderServiceTests
    {
        [Fact]
        public void Compute_ReturnsValue()
        {
            var value = Task.FromResult(42).Result;
            Assert.Equal(42, value);
            Assert.Equal(1, ComputeAsync().GetAwaiter().GetResult());
        }

        private static Task<int> ComputeAsync() => Task.FromResult(1);
    }
}
