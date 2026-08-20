"use client";

import { useRef, useState } from "react";

type Item = { title: string; caption: string; src: string };

/**
 * "See it in action" — a single-still carousel of the core flows: one
 * screenshot shown large at a time with its tagline beneath, plus prev/next
 * arrows and dot indicators to page between them.
 */
export default function Gallery({ items }: { items: Item[] }) {
  const [active, setActive] = useState(0);
  // Mount images lazily: only slides the user has reached (plus the next one,
  // preloaded for a smooth swipe). First paint costs one image, not six.
  const [visited, setVisited] = useState<Set<number>>(() => new Set([0, 1 % items.length]));
  const go = (delta: number) => setActive((a) => {
    const next = (a + delta + items.length) % items.length;
    setVisited((v) => new Set(v).add(next).add((next + 1) % items.length));
    return next;
  });
  const item = items[active];
  // Swipe to page (audit M47) — a carousel that only arrows-taps reads as
  // broken on a phone. Horizontal-dominant swipes only, so vertical scrolling
  // through the splash never accidentally pages.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current.x;
    const dy = e.changedTouches[0].clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  };

  return (
    <div className="gallery" role="group" aria-roledescription="carousel" aria-label="see it in action">
      <div className="gallery-stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <button
          type="button"
          className="gallery-arrow gallery-arrow--prev"
          onClick={() => go(-1)}
          aria-label="previous screenshot"
        >
          ‹
        </button>

        {items.map((g, i) => (
          <figure key={g.src} className={`gallery-slide${i === active ? " is-active" : ""}`} aria-hidden={i !== active}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {visited.has(i) && <img className="gallery-shot" src={`/gallery/${g.src}.jpg`} alt={g.title} decoding="async" />}
            <figcaption className="gallery-label">{g.title}</figcaption>
          </figure>
        ))}

        <button
          type="button"
          className="gallery-arrow gallery-arrow--next"
          onClick={() => go(1)}
          aria-label="next screenshot"
        >
          ›
        </button>
      </div>

      <p className="gallery-caption" aria-live="polite">
        {item.caption}
      </p>

      <div className="gallery-dots">
        {items.map((g, i) => (
          <button
            key={g.src}
            type="button"
            className={`gallery-dot${i === active ? " is-active" : ""}`}
            aria-label={`show “${g.title}”`}
            aria-current={i === active}
            onClick={() => { setVisited((v) => new Set(v).add(i).add((i + 1) % items.length)); setActive(i); }}
          />
        ))}
      </div>
    </div>
  );
}
