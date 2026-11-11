import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MailCheck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Alert } from '@/components/common/Feedback';
import { Button, TextField } from '@/components/common/Form';

const COOLDOWN = 60;
const SENT_KEY = 'ofm.otp.sentAt';

/** Second login step: the 6-digit code emailed after the password. */
export function OtpStep() {
  const { user, sendOtp, verifyOtp, signOut } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [wait, setWait] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (wait <= 0) return;
    const id = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(id);
  }, [wait]);

  const send = async () => {
    setBusy(true);
    setMsg(null);
    const { error } = await sendOtp();
    setBusy(false);
    if (error === 'rate_limited') setMsg({ tone: 'error', text: 'נשלחו יותר מדי קודים. נסו שוב בעוד דקה.' });
    else if (error) setMsg({ tone: 'error', text: 'שליחת הקוד נכשלה. נסו שוב.' });
    else setMsg({ tone: 'info', text: 'שלחנו קוד בן 6 ספרות לאימייל שלכם.' });
    try { sessionStorage.setItem(SENT_KEY, String(Date.now())); } catch { /* ignore */ }
    setWait(COOLDOWN);
  };

  // Send once on arrival (skipped when a code went out in the last minute, e.g. after a reload).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let last = 0;
    try { last = Number(sessionStorage.getItem(SENT_KEY) ?? 0); } catch { /* ignore */ }
    const ago = (Date.now() - last) / 1000;
    if (ago < COOLDOWN) { setWait(Math.ceil(COOLDOWN - ago)); return; }
    void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !/^\d{6}$/.test(code)) return;
    setBusy(true);
    setMsg(null);
    const ok = await verifyOtp(code);
    setBusy(false);
    if (!ok) { setCode(''); setMsg({ tone: 'error', text: 'הקוד שגוי או שפג תוקפו.' }); }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
        <MailCheck className="mt-0.5 size-4 shrink-0 text-sky-600" aria-hidden />
        <p>הזינו את הקוד בן 6 הספרות שנשלח אל <b dir="ltr">{user?.email}</b>.</p>
      </div>
      {msg ? <Alert tone={msg.tone === 'error' ? 'error' : 'info'}>{msg.text}</Alert> : null}
      <TextField
        label="קוד אימות"
        inputMode="numeric"
        autoComplete="one-time-code"
        dir="ltr"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        disabled={busy}
        autoFocus
      />
      <Button type="submit" loading={busy} disabled={code.length !== 6} className="w-full">אימות והמשך</Button>
      <div className="flex items-center justify-between text-xs">
        <button type="button" disabled={busy || wait > 0} onClick={() => void send()} className="font-semibold text-sky-700 hover:underline disabled:text-slate-400 disabled:no-underline dark:text-sky-400">
          {wait > 0 ? `שליחה מחדש בעוד ${wait} שנ׳` : 'שליחת קוד חדש'}
        </button>
        <button type="button" onClick={() => void signOut()} className="text-slate-500 hover:underline">חזרה</button>
      </div>
    </form>
  );
}
