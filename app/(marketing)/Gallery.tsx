"use client";

import { useState } from "react";

type Item = { title: string; caption: string; src: string };

/**
 * "See it in action" — a single-still carousel of the core flows: one
 * screenshot shown large at a time with its tagline beneath, plus prev/next
 * arrows and dot indicators to page between them.
 */
export default function Gallery({ items }: { items: Item[] }) {
  const [active, setActive] = useState(0);
  const go = (delta: number) => setActive((a) => (a + delta + items.length) % items.length);
  const item = items[active];

  return (
    <div className="gallery" role="group" aria-roledescription="carousel" aria-label="see it in action">
      <div className="gallery-stage">
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
            <img className="gallery-shot" src={`/gallery/${g.src}.jpg`} alt={g.title} />
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
            onClick={() => setActive(i)}
          />
        ))}
      </div>
    </div>
  );
}
