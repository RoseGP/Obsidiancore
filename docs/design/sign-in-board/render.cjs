const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: +process.argv[3] || 1 });
  await p.goto('file://' + __dirname + '/board.html', { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  const o = await p.evaluate(() => [...document.querySelectorAll('.win')].map(w => [w.scrollHeight, w.clientHeight]));
  console.log('overflow', JSON.stringify(o));
  await p.screenshot({ path: process.argv[2] });
  await b.close();
})();
