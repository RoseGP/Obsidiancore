/**
 * "Send a test submission" on the Website Forms page. Sends the fields below through the real pipeline
 * (POST /api/web-forms/try): the same validation, spam rules, duplicate check and delivery a visitor's
 * submission gets, so a test that's received creates a real lead in the CRM. Only the allowed-websites and
 * Turnstile checks are skipped, because the test comes from this signed-in page, not from the website.
 * Owners and admins only (the server checks; the panel is disabled for everyone else).
 */
import React, { useId, useState } from 'react';
import { FlaskConical, ArrowRight } from 'lucide-react';
import { Button } from '../../components/localpilot/ui/Button';
import { Badge } from '../../components/localpilot/ui/Badge';

export interface TestDelivery { adapter: 'obsidian' | 'webhook'; status: 'delivered' | 'failed' | 'pending'; attempts: number; detail?: string }
export interface TestResult { status: 'accepted' | 'duplicate' | 'spam'; reason: string | null; visitorMessage: string; deliveries: TestDelivery[] }
type FieldErrors = Partial<Record<'name' | 'email' | 'phone' | 'company' | 'message', string>>;

const REASON: Record<string, string> = { honeypot: 'the hidden spam-trap field was filled', too_fast: 'it was sent faster than a person can type', too_many_links: 'it has more than 3 links', markup: 'it contains HTML' };
const EMAIL = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]{2,}$/; // same rule as the server
const PHONE = /^[+()\d\s.-]{0,40}$/;

/** The same checks the server makes first, so obvious mistakes are caught before sending. The server still decides. */
export function checkTestFields(f: { name: string; email: string; phone: string }): FieldErrors {
  const e: FieldErrors = {};
  if (f.name.trim().length < 2) e.name = 'Please enter your name.';
  if (!EMAIL.test(f.email.trim().toLowerCase())) e.email = 'Please enter a valid email address.';
  if (!PHONE.test(f.phone.trim())) e.phone = 'Please enter a valid phone number.';
  return e;
}

export function TestSubmissionPanel({ disabled, send, onSent, onOpenLeads }: {
  disabled: boolean;
  /** POST /api/web-forms/try. Rejects with { status, message, fields? } like the page's api() helper. */
  send: (body: Record<string, unknown>) => Promise<{ result: TestResult }>;
  onSent: () => void;
  onOpenLeads?: () => void;
}) {
  const uid = useId();
  const [f, setF] = useState({ name: '', email: '', phone: '', company: '', message: '', consent: true, marketingOptIn: false });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [failure, setFailure] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const v = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
    setF((p) => ({ ...p, [k]: v })); if (k in errors) setErrors((p) => ({ ...p, [k]: undefined }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null); setFailure('');
    const local = checkTestFields(f);
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      const r = await send({ ...f, name: f.name.trim(), email: f.email.trim() });
      setResult(r.result); onSent();
    } catch (err: any) {
      if (Array.isArray(err?.fields) && err.fields.length) {
        setErrors(Object.fromEntries(err.fields.map((x: { field: string; message: string }) => [x.field, x.message])));
      } else setFailure(err?.status === 403 ? 'Only owners and admins can send test submissions.' : err?.message || 'The test couldn’t be sent.');
    } finally { setBusy(false); }
  };

  const input = (k: 'name' | 'email' | 'phone' | 'company', label: string, type = 'text', required = false, auto?: string) => (
    <div className="space-y-1">
      <label htmlFor={`${uid}-${k}`} className="block text-xs font-medium text-slate-700">{label}{required && ' *'}</label>
      <input id={`${uid}-${k}`} type={type} value={f[k]} onChange={set(k)} disabled={disabled || busy} autoComplete={auto} aria-required={required || undefined}
        aria-invalid={!!errors[k] || undefined} aria-describedby={errors[k] ? `${uid}-${k}-err` : undefined}
        className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 ${errors[k] ? 'border-rose-400' : 'border-slate-300'}`} />
      {errors[k] && <p id={`${uid}-${k}-err`} className="text-xs text-rose-600">{errors[k]}</p>}
    </div>
  );

  return (
    <section aria-labelledby={`${uid}-title`} className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-4">
      <div>
        <h2 id={`${uid}-title`} className="text-sm font-semibold text-slate-900 flex items-center gap-2"><FlaskConical className="h-4 w-4 text-slate-500" />Send a test submission</h2>
        <p className="text-xs text-slate-500 max-w-2xl">Check the whole path before you go live. The test runs the same checks as your website form and, if it's received, creates a real lead (form name "Website Forms test") you can delete afterwards. The allowed-websites and Turnstile checks are skipped because the test comes from here.</p>
      </div>
      <form noValidate onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        {input('name', 'Name', 'text', true, 'off')}
        {input('email', 'Email', 'email', true, 'off')}
        {input('phone', 'Phone', 'tel', false, 'off')}
        {input('company', 'Company', 'text', false, 'off')}
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor={`${uid}-message`} className="block text-xs font-medium text-slate-700">Message</label>
          <textarea id={`${uid}-message`} rows={3} maxLength={4000} value={f.message} onChange={set('message')} disabled={disabled || busy} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={f.consent} onChange={set('consent')} disabled={disabled || busy} />Agreed to be contacted</label>
        <label className="flex items-center gap-2 text-xs text-slate-700"><input type="checkbox" checked={f.marketingOptIn} onChange={set('marketingOptIn')} disabled={disabled || busy} />Opted in to marketing</label>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={disabled} isLoading={busy}>Send test</Button>
          {disabled && <span className="text-xs text-slate-500">Only owners and admins can send tests.</span>}
        </div>
      </form>

      {failure && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{failure}</p>}
      {result && (
        <div role="status" className={`rounded-lg border p-3 space-y-2 text-sm ${result.status === 'accepted' ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          <p className="font-semibold text-slate-900">
            {result.status === 'accepted' ? 'Received.' : result.status === 'duplicate' ? 'Ignored as a duplicate: the same details were received in the last 10 minutes.' : `Blocked as spam because ${REASON[result.reason || ''] || 'it matched a spam rule'}.`}
          </p>
          {result.deliveries.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {result.deliveries.map((d) => (
                <li key={d.adapter} className="flex flex-wrap items-center gap-1.5 text-xs">
                  <Badge size="xs" variant={d.status === 'delivered' ? 'success' : d.status === 'failed' ? 'danger' : 'info'}>{d.adapter === 'obsidian' ? 'CRM' : 'Webhook'}: {d.status}</Badge>
                  {d.detail && <span className="text-slate-600">{d.detail}</span>}
                  {d.adapter === 'webhook' && d.status === 'pending' && <span className="text-slate-600">Sent in the background; check Recent submissions.</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-600">Your website visitor would see: “{result.visitorMessage}”{result.status !== 'accepted' && ' (spam and duplicates get the same message, so bots learn nothing)'}.</p>
          {result.status === 'accepted' && result.deliveries.some((d) => d.adapter === 'obsidian' && d.status === 'delivered') && onOpenLeads && (
            <Button size="xs" variant="outline" rightIcon={<ArrowRight className="h-3 w-3" />} onClick={onOpenLeads}>Open the lead in Sales Pipeline</Button>
          )}
        </div>
      )}
    </section>
  );
}
