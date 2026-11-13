const { chromium } = require('playwright'); const fs = require('fs');
const html = fs.readFileSync(__dirname + '/dash.html', 'utf8');
const css = html.slice(0, html.indexOf('</style>') + 8), body = html.slice(html.indexOf('</style>') + 8, html.indexOf('<script>')), js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: +process.argv[2] || 1 });
  await p.addInitScript(() => { try { localStorage.setItem('obsidian-theme', 'dark'); } catch {} });
  await p.goto('file://' + require('path').resolve(__dirname, '../../../preview/index.html'), { waitUntil: 'load' });
  await p.waitForSelector('text=Rene Pierrette', { timeout: 30000 });
  await p.click('text=Rene Pierrette');
  await p.waitForSelector('#startup-title', { timeout: 10000 }); await p.click('button:has-text("Skip"), button:has-text("Open workspace")');
  await p.waitForSelector('header', { timeout: 10000 }); await p.waitForTimeout(4000);
  const info = await p.evaluate(({ css, body }) => {
    const head = document.createElement('div'); head.innerHTML = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap">' + css; document.head.append(...head.childNodes);
    const header = [...document.querySelectorAll('header')].find(h => h.className.includes('h-14'));
    const col = header.parentElement;
    [...col.children].forEach(ch => { if (ch !== header) ch.style.display = 'none'; });
    const host = document.createElement('div'); host.innerHTML = body; col.appendChild(host.firstElementChild);
    // preview-only bar, floating inbox button and the "Offline" pill (the preview has no server)
    [...document.querySelectorAll('body *')].forEach(el => { const t = (el.textContent || '').trim(); const cs = getComputedStyle(el);
      if (cs.position === 'fixed' && (t.startsWith('Preview') || t === 'Inbox' || t.startsWith('Authenticated'))) el.style.display = 'none'; });
    const off = [...header.querySelectorAll('*')].find(e => e.children.length <= 2 && (e.textContent || '').trim() === 'Offline'); if (off) off.style.display = 'none';
    return { col: col.className, sidebarW: document.querySelector('aside, nav')?.getBoundingClientRect().width };
  }, { css, body });
  await p.evaluate(js); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(600);
  console.log(JSON.stringify(info));
  await p.screenshot({ path: process.argv[3] || 'dash.png' });
  await b.close();
})();
