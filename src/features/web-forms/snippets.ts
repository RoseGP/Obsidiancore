/** Website form code shown on the Website forms page (all accepted fields; Turnstile when configured). */
// Every field the endpoint accepts. Hidden fields (page, campaign, timing) are filled by the small script.
const fieldsHtml = (siteKey: string | null, jsx = false) => {
  const a = (html: string, react: string) => (jsx ? react : html);
  return `  <label>Name * <input name="name" required ${a('maxlength="120"', 'maxLength={120}')} ${a('autocomplete="name"', 'autoComplete="name"')}></label>
  <label>Email * <input name="email" type="email" required ${a('maxlength="254"', 'maxLength={254}')} ${a('autocomplete="email"', 'autoComplete="email"')}></label>
  <label>Phone <input name="phone" type="tel" ${a('maxlength="40"', 'maxLength={40}')} ${a('autocomplete="tel"', 'autoComplete="tel"')}></label>
  <label>Company <input name="company" ${a('maxlength="160"', 'maxLength={160}')} ${a('autocomplete="organization"', 'autoComplete="organization"')}></label>
  <label>Message <textarea name="message" ${a('maxlength="4000"', 'maxLength={4000}')} rows=${a('"5"', '{5}')}></textarea></label>
  <label><input type="checkbox" name="consent" value="true" required> I agree to be contacted about my request. *</label>
  <label><input type="checkbox" name="marketingOptIn" value="true"> Send me occasional news and offers (optional).</label>
  <input type="hidden" name="formName" value="Contact page">
  <input type="hidden" name="pageUrl">
  <input type="hidden" name="utm_source"><input type="hidden" name="utm_medium"><input type="hidden" name="utm_campaign">
  <input type="hidden" name="_ts">
  ${a('<!-- Spam trap: keep hidden and empty -->', '{/* Spam trap: keep hidden and empty */}')}
  <input type="text" name="_hp" ${a('tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px"', 'tabIndex={-1} autoComplete="off" style={{ position: \'absolute\', left: -9999 }}')} aria-hidden="true">${siteKey ? `
  ${a('<!-- Cloudflare Turnstile: adds the cf-turnstile-response field -->', '{/* Cloudflare Turnstile: adds the cf-turnstile-response field */}')}
  <div className="cf-turnstile" data-sitekey="${siteKey}"></div>`.replace('className', jsx ? 'className' : 'class') : ''}`.replace(/(<input[^>]*?)>/g, jsx ? '$1 />' : '$1>');
};

const turnstileScript = (siteKey: string | null) => (siteKey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>\n' : '');

const fillHidden = `  // Fill the hidden fields: page address, ad-campaign tags from the URL, and when the form was shown.
  const q = new URLSearchParams(location.search);
  form.pageUrl.value = location.href.split('#')[0];
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign']) form[k].value = q.get(k) || '';
  form._ts.value = Date.now();`;

export function htmlSnippet(endpoint: string, siteKey: string | null) {
  return `${turnstileScript(siteKey)}<form id="contact-form" action="${endpoint}" method="POST">
${fieldsHtml(siteKey)}
  <button type="submit">Send</button>
</form>
<script>
  const form = document.getElementById('contact-form');
${fillHidden}
</script>`;
}

export function fetchSnippet(endpoint: string, siteKey: string | null) {
  return `${turnstileScript(siteKey)}<form id="contact-form" novalidate>
${fieldsHtml(siteKey)}
  <button type="submit">Send</button>
  <p id="contact-status" role="status" aria-live="polite"></p>
</form>
<script>
  const form = document.getElementById('contact-form');
  const status = document.getElementById('contact-status');
${fillHidden}
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type=submit]');
    button.disabled = true; status.textContent = 'Sending…';
    try {
      const res = await fetch('${endpoint}', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const out = await res.json();
      if (res.ok) { form.reset(); status.textContent = out.message; }
      else status.textContent = (out.fields || []).map((f) => f.message).join(' ') || out.error;
    } catch { status.textContent = 'Network error. Please try again.'; }
    finally { button.disabled = false;${siteKey ? ' if (window.turnstile) turnstile.reset();' : ''} }
  });
</script>`;
}

export function reactSnippet(endpoint: string, siteKey: string | null) {
  return `// React (Vite, Next.js, Remix… on Cloudflare Pages or anywhere)${siteKey ? `
// Add once to your page <head>: <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : ''}
import { useEffect, useRef, useState } from 'react';

export function ContactForm() {
  const ref = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    const form = ref.current as any;
${fillHidden.replace(/^ {2}/gm, '    ')}
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setStatus('sending'); setErrors([]);
    try {
      const res = await fetch('${endpoint}', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const out = await res.json();
      if (res.ok) { setStatus('sent'); return; }
      setErrors(out.fields?.map((f: { message: string }) => f.message) ?? [out.error]); setStatus('error');
    } catch { setErrors(['Network error. Please try again.']); setStatus('error'); }${siteKey ? `
    (window as any).turnstile?.reset();` : ''}
  }

  if (status === 'sent') return <p role="status">Thanks! We'll be in touch soon.</p>;
  return (
    <form ref={ref} onSubmit={onSubmit}>
${fieldsHtml(siteKey, true).replace(/^/gm, '    ')}
      {errors.length > 0 && <ul role="alert">{errors.map((m) => <li key={m}>{m}</li>)}</ul>}
      <button type="submit" disabled={status === 'sending'}>{status === 'sending' ? 'Sending…' : 'Send'}</button>
    </form>
  );
}`;
}

