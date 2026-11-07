import { useEffect, useId, useRef, useState } from 'react';
import type { OfiMood } from './OfiParts';

const MOOD_COLOR: Record<OfiMood, string> = { calm: '#0e9f8b', alert: '#d98a06', high: '#e0592a', critical: '#b4161b' };

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!m) return;
    const on = () => setReduce(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return reduce;
}

/** CSS for every OFI on the page (class names are global, so one copy is enough). */
const CSS = `
@keyframes ofi-blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.08)}}
@keyframes ofi-glance{0%,30%,100%{transform:translate(0,0)}36%,52%{transform:translate(-1.3px,0)}58%,72%{transform:translate(1.3px,-.3px)}78%{transform:translate(0,0)}}
@keyframes ofi-led{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes ofi-wave{0%,100%{transform:rotate(0)}25%{transform:rotate(-14deg)}75%{transform:rotate(10deg)}}
.ofi-eye{transform-box:fill-box;transform-origin:center;animation:ofi-blink 4.2s infinite}
.ofi-eye.r{animation-delay:.03s}
.ofi-look{animation:ofi-glance 7s ease-in-out infinite}
.ofi-led{animation:ofi-led 1.6s ease-in-out infinite}
.ofi-hand{transform-box:fill-box;transform-origin:50% 100%;transition:transform .35s cubic-bezier(.3,1.6,.5,1)}
.group:hover .ofi-hand,.group:focus-visible .ofi-hand,.ofi-hi .ofi-hand{transform:translate(0,-9px) rotate(-18deg)}
.group:hover .ofi-hand-in,.ofi-hi .ofi-hand-in{animation:ofi-wave .6s ease-in-out 2}
@media (prefers-reduced-motion:reduce){.ofi-eye,.ofi-look,.ofi-led,.ofi-hand-in{animation:none}.ofi-hand{transition:none}}
`;

/**
 * OFI — a cute little soldier. Alive: blinks, glances left and right, follows the pointer with his eyes
 * and waves when hovered (inside an element with the `group` class) or tapped. The mood sets the ring
 * and star colour and the face — fixed to the calm look by choice (the `mood` prop is ignored). Original artwork.
 */
export function OfiAvatar({ size = 44, className }: { mood?: OfiMood; size?: number; className?: string }) {
  // Always the same friendly face and colour (the owner's choice); the risk level lives on the gauge.
  const mood = 'calm' as OfiMood;
  const c = MOOD_COLOR[mood];
  const reduce = useReducedMotion();
  const id = useId();
  const ref = useRef<SVGSVGElement>(null);
  const [look, setLook] = useState<[number, number] | null>(null);
  const [hi, setHi] = useState(false);

  // Eyes follow the pointer (desktop); when it stops for 2.5 s they go back to the idle glance.
  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / 160);
        setLook([(dx / d) * 1.4 * k, (dy / d) * 1 * k]);
        clearTimeout(idle);
        idle = setTimeout(() => setLook(null), 2500);
      });
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => {
      window.removeEventListener('pointermove', move);
      cancelAnimationFrame(raf);
      clearTimeout(idle);
    };
  }, [reduce]);

  // A tap (phones have no hover) makes him wave once.
  const wave = () => {
    if (reduce) return;
    setHi(true);
    setTimeout(() => setHi(false), 1400);
  };

  const eyeR = mood === 'calm' ? 2.1 : 2.6;
  return (
    <svg
      ref={ref}
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={[className, hi ? 'ofi-hi' : ''].filter(Boolean).join(' ')}
      role="img"
      aria-label={`OFI (${mood})`}
      onPointerDown={wave}
    >
      <style>{CSS}</style>
      <defs>
        <clipPath id={`${id}-c`}><circle cx="24" cy="24" r="21" /></clipPath>
      </defs>
      <circle cx="24" cy="24" r="22" fill="#e8efe2" stroke={c} strokeWidth="2.5" />
      <g clipPath={`url(#${id}-c)`}>
        <path d="M6 48 Q8 37 24 36 Q40 37 42 48 Z" fill="#5b6b3a" />
        <path d="M20 36 L24 41 L28 36 Z" fill="#f0c9a0" />
        {/* waving hand (rises on hover / tap) */}
        <g className="ofi-hand">
          <g className="ofi-hand-in" style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }}>
            <path d="M36 47 L37.5 38" stroke="#5b6b3a" strokeWidth="4" strokeLinecap="round" />
            <circle cx="37.7" cy="37" r="2.6" fill="#f6d3ae" stroke="#c9a27c" strokeWidth=".5" />
          </g>
        </g>
      </g>
      <ellipse cx="24" cy="27" rx="11" ry="10" fill="#f6d3ae" />
      {/* helmet + antenna with a blinking light (no spinning) */}
      <path d="M30.5 11 L32.3 6.6" stroke="#33401c" strokeWidth="1.1" strokeLinecap="round" />
      <circle className="ofi-led" cx="32.5" cy="6" r="1.7" fill={c} stroke="#fff" strokeWidth=".5" />
      <path d="M11.5 24 Q11 9 24 8.5 Q37 9 36.5 24 Q24 20 11.5 24 Z" fill="#6f8040" stroke="#4a5a2a" strokeWidth="1" />
      <path d="M15 15 Q18 11 23 10.5" fill="none" stroke="#fff" strokeOpacity=".25" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M9.5 24.5 Q24 19.5 38.5 24.5" fill="none" stroke="#4a5a2a" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M24 11.2 l1.2 2.5 2.7.3-2 1.9.6 2.7-2.5-1.4-2.5 1.4.6-2.7-2-1.9 2.7-.3z" fill={c} stroke="#fff" strokeWidth=".5" />
      {/* eyes: the white blinks, the pupils glance / follow the pointer */}
      <g className="ofi-eye">
        <circle cx="19.5" cy="27.5" r={eyeR} fill="#fff" stroke="#33401c" strokeWidth=".8" />
      </g>
      <g className="ofi-eye r">
        <circle cx="28.5" cy="27.5" r={eyeR} fill="#fff" stroke="#33401c" strokeWidth=".8" />
      </g>
      <g style={look ? { transform: `translate(${look[0]}px, ${look[1]}px)`, transition: 'transform .15s' } : undefined}>
        <g className={look ? undefined : 'ofi-look'}>
          <g className="ofi-eye"><circle cx="19.5" cy="27.8" r="1.2" fill="#1e2a10" /></g>
          <g className="ofi-eye r"><circle cx="28.5" cy="27.8" r="1.2" fill="#1e2a10" /></g>
        </g>
      </g>
      {mood === 'high' || mood === 'critical' ? (
        <>
          <path d="M16.5 23.6 L21.5 25" stroke="#4a3a20" strokeWidth="1.3" strokeLinecap="round" />
          <path d="M31.5 23.6 L26.5 25" stroke="#4a3a20" strokeWidth="1.3" strokeLinecap="round" />
        </>
      ) : null}
      {mood === 'calm' ? (
        <path d="M20.5 32.2 Q24 35 27.5 32.2" fill="none" stroke="#8a4a32" strokeWidth="1.4" strokeLinecap="round" />
      ) : mood === 'alert' ? (
        <path d="M21.5 33 L26.5 33" stroke="#8a4a32" strokeWidth="1.4" strokeLinecap="round" />
      ) : (
        <path d="M20.5 34 Q24 31.2 27.5 34" fill="none" stroke="#8a4a32" strokeWidth="1.4" strokeLinecap="round" />
      )}
      <circle cx="16" cy="31" r="1.6" fill="#f08a7a" fillOpacity=".45" />
      <circle cx="32" cy="31" r="1.6" fill="#f08a7a" fillOpacity=".45" />
    </svg>
  );
}
