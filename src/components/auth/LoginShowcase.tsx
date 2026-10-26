import { useEffect, useRef, useState } from 'react';
import { Radio } from 'lucide-react';
import { useI18n } from '@/i18n';

/** Rotating dotted globe with events that light up and fade (decorative canvas). */
export function LoginGlobe({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const N = 1400;
    const pts = Array.from({ length: N }, (_, i) => {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = i * 2.399963;
      return [Math.cos(th) * r, y, Math.sin(th) * r] as const;
    });
    const COLORS = ['#f43f5e', '#f97316', '#38bdf8', '#a855f7', '#facc15'];
    type Ev = { lat: number; lon: number; born: number; color: string };
    const evs: Ev[] = [];
    const spawn = (now: number) => {
      // Mostly the Middle East, sometimes elsewhere.
      const me = Math.random() < 0.75;
      evs.push({
        lat: me ? 24 + Math.random() * 14 : -40 + Math.random() * 100,
        lon: me ? 32 + Math.random() * 24 : -150 + Math.random() * 300,
        born: now,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      });
      if (evs.length > 28) evs.shift();
    };
    let raf = 0;
    let last = 0;
    const tilt = 0.38;
    const draw = (now: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const R = Math.min(w, h) * 0.46, cx = w / 2, cy = h / 2;
      // Keep the Middle East facing the viewer, swaying slowly.
      const rot = reduce ? -0.75 : -0.75 + Math.sin(now / 9000) * 0.9;
      const proj = (x: number, y: number, z: number) => {
        const x1 = x * Math.cos(rot) + z * Math.sin(rot);
        const z1 = -x * Math.sin(rot) + z * Math.cos(rot);
        const y1 = y * Math.cos(tilt) - z1 * Math.sin(tilt);
        const z2 = y * Math.sin(tilt) + z1 * Math.cos(tilt);
        return [cx + x1 * R, cy - y1 * R, z2] as const;
      };
      const halo = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.25);
      halo.addColorStop(0, 'rgba(56,189,248,0.10)');
      halo.addColorStop(1, 'rgba(56,189,248,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);
      for (const [x, y, z] of pts) {
        const [px, py, pz] = proj(x, y, z);
        if (pz < -0.05) continue;
        ctx.fillStyle = `rgba(125,211,252,${0.12 + pz * 0.5})`;
        ctx.fillRect(px, py, 1.4, 1.4);
      }
      if (!reduce && now - last > 650) { spawn(now); last = now; }
      if (reduce && !evs.length) for (let i = 0; i < 12; i++) spawn(now - i * 400);
      const alive: [number, number, string][] = [];
      for (const e of evs) {
        const age = (now - e.born) / 1000;
        const life = reduce ? 0.5 : age;
        if (life > 6) continue;
        const la = (e.lat * Math.PI) / 180, lo = (e.lon * Math.PI) / 180;
        const [px, py, pz] = proj(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo));
        if (pz < 0) continue;
        const fade = life < 0.4 ? life / 0.4 : life > 4.5 ? (6 - life) / 1.5 : 1;
        ctx.globalAlpha = Math.max(0, fade);
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, 3 + (life % 1.6) * 9, 0, Math.PI * 2);
        ctx.globalAlpha = Math.max(0, fade * (1 - (life % 1.6) / 1.6));
        ctx.stroke();
        ctx.globalAlpha = Math.max(0, fade);
        ctx.fillStyle = e.color;
        ctx.beginPath();
        ctx.arc(px, py, 2.6, 0, Math.PI * 2);
        ctx.fill();
        alive.push([px, py, e.color]);
      }
      // Thin links between recent events.
      ctx.lineWidth = 0.8;
      for (let i = 1; i < alive.length; i++) {
        const [ax, ay] = alive[i - 1], [bx, by, c] = alive[i];
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = c;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.quadraticCurveTo((ax + bx) / 2, Math.min(ay, by) - 30, bx, by);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className={className} aria-hidden />;
}

const DEMO: Record<'he' | 'en', [string, string, string][]> = {
  he: [
    ['#f43f5e', 'תקיפה אווירית', 'דיווח על פיצוצים באזור התעשייה'],
    ['#f97316', 'ירי רקטות', 'שיגור מזוהה מדרום לבנון'],
    ['#38bdf8', 'תנועת כוחות', 'שיירה ממונעת נצפתה על כביש ראשי'],
    ['#a855f7', 'הצהרה', 'דובר צבאי: "התגובה תגיע בזמן שנבחר"'],
    ['#facc15', 'ימי', 'כלי שיט שינה מסלול במצר'],
    ['#f43f5e', 'כטב"ם', 'יירוט כלי טיס בלתי מאויש מעל הים'],
  ],
  en: [
    ['#f43f5e', 'Airstrike', 'Explosions reported in the industrial zone'],
    ['#f97316', 'Rocket fire', 'Launch detected from south Lebanon'],
    ['#38bdf8', 'Force movement', 'Armored convoy sighted on a main road'],
    ['#a855f7', 'Statement', 'Military spokesman: "the response will come"'],
    ['#facc15', 'Maritime', 'Vessel changed course in the strait'],
    ['#f43f5e', 'Drone', 'UAV intercepted over the sea'],
  ],
};

/** Example reports popping in (demo content, labelled as such). */
export function LoginTicker() {
  const { lang } = useI18n();
  const items = DEMO[lang === 'he' ? 'he' : 'en'];
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setI((v) => v + 1), 2600);
    return () => clearInterval(id);
  }, []);
  const shown = [0, 1, 2].map((k) => ({ key: i - k, item: items[(((i - k) % items.length) + items.length) % items.length] }));
  return (
    <div className="flex w-full max-w-sm flex-col gap-2" aria-hidden>
      {shown.map(({ key, item: [color, cat, text] }, k) => (
        <div
          key={key}
          className="ofm-login__card flex items-start gap-3 rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 shadow-lg shadow-black/30 backdrop-blur"
          style={{ opacity: 1 - k * 0.3 }}
        >
          <span className="relative mt-1.5 flex size-2.5 shrink-0">
            <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: color }} />
            <span className="relative size-2.5 rounded-full" style={{ background: color }} />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color }}>{cat}</p>
            <p className="truncate text-sm text-slate-100">{text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function LiveBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/40 bg-rose-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-rose-300">
      <Radio className="size-3.5 animate-pulse" aria-hidden />
      {label}
    </span>
  );
}
