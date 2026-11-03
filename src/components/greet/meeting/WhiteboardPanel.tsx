/** Collaborative whiteboard. Strokes are stored normalised (0–1) so every screen size draws the same board. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Eraser, Pencil, Trash2, Undo2 } from 'lucide-react';
import type { WhiteboardStroke } from '../../../lib/meetingRealtime';

const COLORS = ['#1f2333', '#e5484d', '#f5a524', '#30a46c', '#3e63dd', '#8e4ec6'];
const SIZES = [2, 4, 8];

function draw(ctx: CanvasRenderingContext2D, s: WhiteboardStroke, w: number, h: number) {
  if (s.points.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.tool === 'eraser' ? s.size * 4 : s.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  s.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * w, y * h) : ctx.lineTo(x * w, y * h)));
  if (s.points.length === 1) ctx.lineTo(s.points[0][0] * w + 0.1, s.points[0][1] * h);
  ctx.stroke();
  ctx.restore();
}

export function WhiteboardPanel({ strokes, onStroke, onClear, onUndo }: {
  strokes: WhiteboardStroke[]; onStroke: (s: WhiteboardStroke) => void; onClear: () => void; onUndo?: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<WhiteboardStroke | null>(null);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState(COLORS[4]);
  const [size, setSize] = useState(SIZES[1]);
  const [confirmClear, setConfirmClear] = useState(false);

  const redraw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const { width, height } = c;
    ctx.clearRect(0, 0, width, height);
    for (const s of strokes) draw(ctx, s, width, height);
    if (live.current) draw(ctx, live.current, width, height);
  }, [strokes]);

  useEffect(() => {
    const el = wrap.current, c = canvas.current;
    if (!el || !c) return;
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const r = el.getBoundingClientRect();
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      c.style.width = `${r.width}px`;
      c.style.height = `${r.height}px`;
      redraw();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [redraw]);
  useEffect(redraw, [redraw]);

  const pt = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  const down = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const dpr = window.devicePixelRatio || 1;
    live.current = { id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, color, size: size * dpr, tool, points: [pt(e)] };
    redraw();
  };
  const move = (e: React.PointerEvent) => {
    if (!live.current) return;
    live.current.points.push(pt(e));
    redraw();
  };
  const up = () => {
    const s = live.current;
    live.current = null;
    if (!s) return;
    // Thin out dense paths to keep events small.
    const pts = s.points.filter((p, i) => i === 0 || i === s.points.length - 1 || i % 2 === 0).map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4] as [number, number]);
    onStroke({ ...s, points: pts.slice(0, 600) });
  };

  const exportPng = () => {
    const c = canvas.current;
    if (!c) return;
    const out = document.createElement('canvas');
    out.width = c.width; out.height = c.height;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(c, 0, 0);
    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = `whiteboard-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`;
    a.click();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Whiteboard tools">
        <div className="m-seg" role="radiogroup" aria-label="Tool">
          <button type="button" role="radio" aria-checked={tool === 'pen'} onClick={() => setTool('pen')} aria-label="Pen"><Pencil size={14} /></button>
          <button type="button" role="radio" aria-checked={tool === 'eraser'} onClick={() => setTool('eraser')} aria-label="Eraser"><Eraser size={14} /></button>
        </div>
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Colour">
          {COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Colour ${c}`} onClick={() => { setColor(c); setTool('pen'); }}
              className="h-6 w-6 rounded-full" style={{ background: c, border: 0, cursor: 'pointer', boxShadow: color === c && tool === 'pen' ? '0 0 0 2px var(--m-solid), 0 0 0 4px var(--m-accent)' : 'inset 0 0 0 1px rgba(0,0,0,.15)' }} />
          ))}
        </div>
        <div className="m-seg" role="radiogroup" aria-label="Line width">
          {SIZES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={size === s} onClick={() => setSize(s)} aria-label={`Width ${s}`}>
              <span className="inline-block rounded-full" style={{ width: s + 4, height: s + 4, background: 'currentColor' }} />
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {onUndo && <button type="button" className="m-icon-btn" aria-label="Undo last stroke" title="Undo" onClick={onUndo}><Undo2 size={16} /></button>}
        <button type="button" className="m-icon-btn" aria-label="Download as PNG" title="Download PNG" onClick={exportPng}><Download size={16} /></button>
        {confirmClear ? (
          <span className="flex items-center gap-1">
            <button type="button" className="m-btn m-btn-danger m-btn-sm" onClick={() => { onClear(); setConfirmClear(false); }}>Clear for everyone</button>
            <button type="button" className="m-btn m-btn-ghost m-btn-sm" onClick={() => setConfirmClear(false)}>Cancel</button>
          </span>
        ) : (
          <button type="button" className="m-icon-btn" aria-label="Clear whiteboard" title="Clear" onClick={() => setConfirmClear(true)}><Trash2 size={16} /></button>
        )}
      </div>
      <div ref={wrap} className="relative min-h-[240px] flex-1 overflow-hidden rounded-xl" style={{ background: '#fbfbfd', boxShadow: 'inset 0 0 0 1px var(--m-line-strong)', backgroundImage: 'radial-gradient(#d9dce6 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
        <canvas ref={canvas} className="absolute inset-0 touch-none" style={{ cursor: tool === 'eraser' ? 'cell' : 'crosshair' }} aria-label="Whiteboard drawing area"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={(e) => { if (e.buttons === 0) up(); }} />
        {strokes.length === 0 && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px]" style={{ color: '#8a8fa3' }}>Draw here. Everyone in the meeting sees the same board.</p>}
      </div>
    </div>
  );
}
