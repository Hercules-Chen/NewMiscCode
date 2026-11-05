// Example --script for `node src/cli.js record <url> --script test/fixtures/demo-steps.js`.
// Drives 01-mcp-ui-verifier's demo site; the recorder captures everything the script does.
export default async function ({ page, recorder }) {
  await page.fill('#username', '小明');
  await page.fill('#password', 'secret123');
  await page.click('#login-btn');
  await recorder.flush();
  // Toolbar: add an assertion on the welcome message.
  await page.click('[data-uirec-act=assert]');
  await page.click('#login-msg');
  await recorder.flush();
}
