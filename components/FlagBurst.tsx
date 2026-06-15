"use client";

import { useEffect, useRef } from "react";

const COLORS = ["#f5c518", "#e2483f", "#2fb673", "#f59e2a"];

/**
 * At max zoom a football can't split further (we don't know addresses), so it
 * bursts into a disk of flags that behave like the site background: move the
 * cursor through them and gravity gathers them into a pile. Once they coalesce,
 * a "propose new game here?" button rides the pile — click it to start the
 * suggest flow.
 */
export function FlagBurst({
  origin, count, onPropose, onClose,
}: {
  origin: { x: number; y: number };
  count: number;
  onPropose: () => void;
  onClose: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current!, canvas = canvasRef.current!, btn = btnRef.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const PI2 = Math.PI * 2;
    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    const N = Math.max(12, Math.min(30, count + 6));
    const DISK = 125, GR = 160, GATHER = 54;
    type Flag = { hx: number; hy: number; x: number; y: number; ox: number; oy: number;
      size: number; rot: number; phase: number; energy: number; color: string };
    let W = 0, H = 0, raf: number | null = null, flags: Flag[] = [];
    let mx = origin.x, my = origin.y, coalesced = false;

    function size() {
      const r = wrap.getBoundingClientRect();
      W = r.width; H = r.height;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + "px"; canvas.style.height = H + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function build() {
      flags = [];
      for (let i = 0; i < N; i++) {
        const a = rand(0, PI2), rr = Math.sqrt(Math.random()) * DISK;
        const hx = origin.x + Math.cos(a) * rr, hy = origin.y + Math.sin(a) * rr;
        flags.push({ hx, hy, x: hx, y: hy, ox: rand(-16, 16), oy: rand(-16, 16),
          size: rand(9, 15), rot: rand(0, PI2), phase: rand(0, PI2), energy: 0,
          color: COLORS[(Math.random() * COLORS.length) | 0] });
      }
    }
    function drawFlag(f: Flag) {
      const L = f.size * 3, h = f.size * 0.5, seg = 6;
      ctx.save();
      ctx.translate(f.x, f.y); ctx.rotate(f.rot);
      ctx.globalAlpha = 0.4 + 0.6 * f.energy;
      ctx.fillStyle = f.color;
      ctx.beginPath();
      for (let i = 0; i <= seg; i++) {
        const t = i / seg, x = t * L;
        const w = Math.sin(f.phase + t * 6) * h * 1.2 * t * f.energy;
        if (i === 0) ctx.moveTo(x, w - h / 2); else ctx.lineTo(x, w - h / 2);
      }
      for (let i = seg; i >= 0; i--) {
        const t = i / seg, x = t * L;
        const w = Math.sin(f.phase + t * 6) * h * 1.2 * t * f.energy;
        ctx.lineTo(x, w + h / 2);
      }
      ctx.closePath(); ctx.fill(); ctx.restore();
    }
    function frame() {
      ctx.clearRect(0, 0, W, H);
      let near = 0;
      for (const f of flags) {
        const dx = mx - f.x, dy = my - f.y, d = Math.hypot(dx, dy);
        if (d < GR) {
          const close = 1 - d / GR, pull = 0.04 + 0.2 * close;
          f.x += (mx + f.ox - f.x) * pull; f.y += (my + f.oy - f.y) * pull;
          f.energy += (0.45 + 0.55 * close - f.energy) * 0.14;
        } else {
          f.x += (f.hx - f.x) * 0.06; f.y += (f.hy - f.y) * 0.06;
          f.energy += (0 - f.energy) * 0.12;
        }
        if (f.energy < 0.004) f.energy = 0;
        if (f.energy > 0.004) f.phase += 0.25;
        drawFlag(f);
        if (Math.hypot(f.x - mx, f.y - my) < GATHER) near++;
      }
      const now = near >= Math.ceil(N * 0.6);
      if (now !== coalesced) {
        coalesced = now;
        btn.style.opacity = now ? "1" : "0";
        btn.style.pointerEvents = now ? "auto" : "none";
      }
      if (coalesced) { btn.style.left = mx + "px"; btn.style.top = my - 52 + "px"; }
      raf = requestAnimationFrame(frame);
    }
    const onMove = (e: PointerEvent) => {
      const r = wrap.getBoundingClientRect();
      mx = e.clientX - r.left; my = e.clientY - r.top;
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };

    size(); build();
    wrap.addEventListener("pointermove", onMove);
    window.addEventListener("keydown", onKey);
    raf = requestAnimationFrame(frame);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      wrap.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKey);
    };
  }, [origin, count, onClose]);

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0, zIndex: 5,
      background: "rgba(8,12,10,.55)", backdropFilter: "blur(1px)", cursor: "crosshair" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: 14, left: 0, right: 0, textAlign: "center",
        color: "#fff", fontSize: 13, pointerEvents: "none", textShadow: "0 1px 5px #000" }}>
        move your cursor through the flags to gather them
      </div>
      <button onClick={onClose} aria-label="close" style={{ position: "absolute", top: 10, right: 12,
        background: "rgba(0,0,0,.45)", color: "#fff", border: "none", borderRadius: 6,
        width: 28, height: 28, fontSize: 16, cursor: "pointer", lineHeight: 1 }}>×</button>
      <button ref={btnRef} onClick={onPropose} style={{ position: "absolute", transform: "translate(-50%,-50%)",
        opacity: 0, pointerEvents: "none", transition: "opacity .15s", background: "#f5c518",
        color: "#1a1407", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700,
        fontSize: 14, cursor: "pointer", boxShadow: "0 4px 18px rgba(0,0,0,.55)", whiteSpace: "nowrap",
        fontFamily: "var(--font-barlow), sans-serif" }}>
        propose new game here?
      </button>
    </div>
  );
}
