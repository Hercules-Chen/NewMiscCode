// csrules-disable-file R3
// 整個檔案抑制 R3（舊版 COM 介面相容層）
namespace SampleApp.Violations
{
    public class LegacyInterop
    {
        public int GetSize(out int width, out int height)
        {
            width = 1;
            height = 2;
            return 0;
        }
    }
}
