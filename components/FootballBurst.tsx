"use client";

import { useEffect, useRef } from "react";

/**
 * At max zoom a zip's football can't split further (no addresses), so clicking
 * it bursts it into a ring of mini-footballs — one per interested neighbor —
 * that springs out and then follows your cursor. A "propose new game here?"
 * button rides the center of the ring; click it to start the suggest flow.
 */
export function FootballBurst({
  origin, count, onPropose, onClose,
}: {
  origin: { x: number; y: number };
  count: number;
  onPropose: () => void;
  onClose: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current!, btn = btnRef.current!;
    const N = Math.max(5, Math.min(16, count));
    const R = 84;

    // one mini-football <img> per neighbor
    const balls: { el: HTMLImageElement; a0: number }[] = [];
    for (let i = 0; i < N; i++) {
      const el = document.createElement("img");
      el.src = "/football.png";
      el.draggable = false;
      el.style.cssText = `position:absolute;width:30px;height:30px;left:0;top:0;will-change:transform;
        filter:drop-shadow(0 0 5px #ffcf33) drop-shadow(0 2px 3px rgba(0,0,0,.5));pointer-events:none;`;
      wrap.appendChild(el);
      balls.push({ el, a0: (i / N) * Math.PI * 2 });
    }

    let cx = origin.x, cy = origin.y, mx = origin.x, my = origin.y;
    let p = 0, t = 0, raf = 0, shown = false;

    function frame() {
      p += (1 - p) * 0.07;          // ring springs out from the origin
      cx += (mx - cx) * 0.18;       // center chases the cursor
      cy += (my - cy) * 0.18;
      t += 0.006;                   // slow orbit
      const r = R * p;
      for (const b of balls) {
        const a = b.a0 + t;
        const bx = cx + Math.cos(a) * r, by = cy + Math.sin(a) * r;
        b.el.style.transform = `translate(${bx}px,${by}px) translate(-50%,-50%) rotate(${a * 0.4}rad)`;
      }
      btn.style.transform = `translate(${cx}px,${cy}px) translate(-50%,-50%)`;
      if (!shown && p > 0.55) { shown = true; btn.style.opacity = "1"; btn.style.pointerEvents = "auto"; }
      raf = requestAnimationFrame(frame);
    }
    const onMove = (e: PointerEvent) => {
      const r = wrap.getBoundingClientRect();
      mx = e.clientX - r.left; my = e.clientY - r.top;
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };

    // reveal the propose button on a timer (robust to throttled rAF), in
    // addition to the spring-progress check above
    const revealT = setTimeout(() => {
      shown = true; btn.style.opacity = "1"; btn.style.pointerEvents = "auto";
    }, 550);

    wrap.addEventListener("pointermove", onMove);
    window.addEventListener("keydown", onKey);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(revealT);
      wrap.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKey);
      balls.forEach((b) => b.el.remove());
    };
  }, [origin, count, onClose]);

  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0, zIndex: 5,
      background: "rgba(8,14,10,.5)", backdropFilter: "blur(1px)", cursor: "crosshair" }}>
      <div style={{ position: "absolute", top: 14, left: 0, right: 0, textAlign: "center",
        color: "#fff", fontSize: 13, pointerEvents: "none", textShadow: "0 1px 5px #000" }}>
        these neighbors want a game — propose one for them
      </div>
      <button onClick={onClose} aria-label="close" style={{ position: "absolute", top: 10, right: 12,
        background: "rgba(0,0,0,.45)", color: "#fff", border: "none", borderRadius: 6,
        width: 28, height: 28, fontSize: 16, cursor: "pointer", lineHeight: 1, zIndex: 6 }}>×</button>
      <button ref={btnRef} onClick={onPropose} style={{ position: "absolute", left: 0, top: 0,
        opacity: 0, pointerEvents: "none", transition: "opacity .2s", background: "#f5c518",
        color: "#1a1407", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700,
        fontSize: 14, cursor: "pointer", boxShadow: "0 4px 18px rgba(0,0,0,.55)", whiteSpace: "nowrap",
        fontFamily: "var(--font-barlow), sans-serif" }}>
        propose new game here?
      </button>
    </div>
  );
}
