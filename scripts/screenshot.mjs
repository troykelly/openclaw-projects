import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/home/vscode/.cache/ms-playwright/chromium-1208/chrome-linux/chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // Collect console errors
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push('PAGE ERROR: ' + err.message));

  // Get a fresh token
  const resp = await fetch('http://localhost:3000/api/auth/request-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'demo@openclaw.dev' }),
  });
  const { loginUrl } = await resp.json();
  console.log('Login URL:', loginUrl);

  // Login
  await page.goto(loginUrl, { waitUntil: 'networkidle0', timeout: 30000 });
  console.log('After login, URL:', page.url());

  // Wait for React to render
  await new Promise((r) => setTimeout(r, 3000));

  // Take screenshot
  await page.screenshot({ path: '/tmp/frontend-screenshot.png', fullPage: true });
  console.log('Screenshot saved to /tmp/frontend-screenshot.png');

  // Navigate to dashboard
  await page.goto('http://localhost:3000/app/dashboard', { waitUntil: 'networkidle0', timeout: 30000 });
  console.log('Dashboard URL:', page.url());
  await new Promise((r) => setTimeout(r, 3000));
  await page.screenshot({ path: '/tmp/dashboard-screenshot.png', fullPage: true });
  console.log('Dashboard screenshot saved to /tmp/dashboard-screenshot.png');

  // Get page info
  console.log('Page title:', await page.title());

  // Check if root element has content
  const rootContent = await page.evaluate(() => {
    const root = document.getElementById('root');
    return {
      hasContent: root ? root.innerHTML.length : 0,
      childCount: root ? root.children.length : 0,
      firstChildTag: root?.firstElementChild?.tagName || 'none',
    };
  });
  console.log('Root element:', rootContent);

  // Print errors
  if (errors.length > 0) {
    console.log('Console errors:');
    errors.forEach((e) => console.log('  -', e));
  } else {
    console.log('No console errors detected');
  }
} catch (err) {
  console.error('Error:', err);
} finally {
  await browser.close();
}
