"use client";

import { useEffect, useRef } from "react";
import { TEAM_YELLOW, TEAM_BLUE } from "@/lib/brand";

/**
 * Site-wide background: scattered flags lie inert across the (map-grid) space and
 * get pulled into a fluttering pile by cursor "gravity"; they drift home and go
 * still when the cursor leaves. Ported from the static site's bg partial, with
 * proper React cleanup. Respects prefers-reduced-motion.
 */
export function FlagFieldCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const reduce =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const COLORS = [TEAM_YELLOW, TEAM_BLUE]; // two teams, yellow vs blue
    const GR = 168; // gravity radius
    const PI2 = Math.PI * 2;

    type Flag = {
      hx: number; hy: number; x: number; y: number; ox: number; oy: number;
      size: number; rot: number; phase: number; energy: number; color: string;
    };

    let W = 0, H = 0, flags: Flag[] = [], mx = -99999, my = -99999, raf: number | null = null;
    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    function build() {
      dpr = Math.min(window.devicePixelRatio || 1, 2); // refresh on resize / DPR change
      W = window.innerWidth; H = window.innerHeight;
      c!.width = W * dpr; c!.height = H * dpr;
      c!.style.width = W + "px"; c!.style.height = H + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.max(31, Math.min(117, Math.round((W * H) / 20000)));
      flags = [];
      for (let i = 0; i < n; i++) {
        const hx = rand(0, W), hy = rand(0, H);
        flags.push({
          hx, hy, x: hx, y: hy, ox: rand(-26, 26), oy: rand(-26, 26),
          size: rand(7, 13), rot: rand(0, PI2), phase: rand(0, PI2),
          energy: 0, color: COLORS[(Math.random() * COLORS.length) | 0],
        });
      }
    }

    function drawFlag(f: Flag) {
      const L = f.size * 3, h = f.size * 0.5, seg = 6;
      ctx!.save();
      ctx!.translate(f.x, f.y);
      ctx!.rotate(f.rot);
      ctx!.globalAlpha = 0.26 + 0.64 * f.energy;
      ctx!.fillStyle = f.color;
      ctx!.beginPath();
      for (let i = 0; i <= seg; i++) {
        const t = i / seg, x = t * L;
        const w = Math.sin(f.phase + t * 6) * h * 1.2 * t * f.energy;
        if (i === 0) ctx!.moveTo(x, w - h / 2); else ctx!.lineTo(x, w - h / 2);
      }
      for (let i = seg; i >= 0; i--) {
        const t = i / seg, x = t * L;
        const w = Math.sin(f.phase + t * 6) * h * 1.2 * t * f.energy;
        ctx!.lineTo(x, w + h / 2);
      }
      ctx!.closePath();
      ctx!.fill();
      ctx!.restore();
    }

    function frame() {
      ctx!.clearRect(0, 0, W, H);
      let active = false;
      const on = !reduce && mx > -9000;
      for (const f of flags) {
        const dx = mx - f.x, dy = my - f.y, d = Math.sqrt(dx * dx + dy * dy);
        const near = on && d < GR;
        if (near) {
          const closeness = 1 - d / GR;
          const pull = 0.03 + 0.18 * closeness;
          f.x += (mx + f.ox - f.x) * pull;
          f.y += (my + f.oy - f.y) * pull;
          const etarget = 0.4 + 0.6 * closeness;
          f.energy += (etarget - f.energy) * 0.14;
        } else {
          f.x += (f.hx - f.x) * 0.06;
          f.y += (f.hy - f.y) * 0.06;
          f.energy += (0 - f.energy) * 0.12;
        }
        if (f.energy < 0.004) f.energy = 0;
        if (f.energy > 0.004) f.phase += 0.25;
        drawFlag(f);
        if (f.energy > 0.004) active = true;
        if (Math.abs(f.x - f.hx) > 0.4 || Math.abs(f.y - f.hy) > 0.4) active = true;
      }
      raf = active ? requestAnimationFrame(frame) : null;
    }

    function wake() { if (raf == null) raf = requestAnimationFrame(frame); }
    const onMove = (e: PointerEvent) => { mx = e.clientX; my = e.clientY; wake(); };
    const onLeave = () => { mx = -99999; my = -99999; wake(); };
    const onResize = () => { if (raf != null) { cancelAnimationFrame(raf); raf = null; } build(); frame(); };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", onResize);
    build();
    frame();

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", onResize);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas id="bg" ref={ref} aria-hidden="true" />;
}
