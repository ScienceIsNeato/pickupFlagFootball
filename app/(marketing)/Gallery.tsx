"use client";

import { useEffect, useRef, useState } from "react";

type Item = { title: string; caption: string; src: string };

/**
 * "See it in action" — a single-clip carousel: one flow shown large at a time,
 * with prev/next arrows and dot indicators to page between them. Only the
 * visible clip plays. Honours WCAG 2.2.2 (Pause, Stop, Hide): no autoplay when
 * the viewer asked for reduced motion, plus a discreet play/pause control.
 */
export default function Gallery({ items }: { items: Item[] }) {
  const videos = useRef<Array<HTMLVideoElement | null>>([]);
  const stage = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  // Start paused; an effect flips this on once we know the motion preference, so
  // reduced-motion viewers never see a frame of movement.
  const [playing, setPlaying] = useState(false);
  // Browsers won't play a muted clip that's off-screen, so only drive playback
  // while the carousel is actually in view.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(true);
  }, []);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {
      threshold: 0.35,
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Only the active clip plays — and only when it's on-screen and not paused.
  // The rest stay parked on their first frame so paging feels instant.
  useEffect(() => {
    videos.current.forEach((v, i) => {
      if (!v) return;
      if (i === active && playing && visible) v.play().catch(() => {});
      else v.pause();
    });
  }, [active, playing, visible]);

  const go = (delta: number) => setActive((a) => (a + delta + items.length) % items.length);

  return (
    <div className="gallery" role="group" aria-roledescription="carousel" aria-label="see it in action">
      <div className="gallery-stage" ref={stage}>
        <button
          type="button"
          className="gallery-arrow gallery-arrow--prev"
          onClick={() => go(-1)}
          aria-label="previous clip"
        >
          ‹
        </button>

        {items.map((g, i) => (
          <figure
            key={g.src}
            className={`gallery-slide${i === active ? " is-active" : ""}`}
            aria-hidden={i !== active}
          >
            <video
              ref={(el) => {
                videos.current[i] = el;
              }}
              className="gallery-video"
              loop
              muted
              playsInline
              preload="metadata"
              poster={`/gallery/${g.src}.jpg`}
              aria-label={g.title}
            >
              <source src={`/gallery/${g.src}.webm`} type="video/webm" />
              <source src={`/gallery/${g.src}.mp4`} type="video/mp4" />
            </video>
            <figcaption className="gallery-label">{g.title}</figcaption>
          </figure>
        ))}

        <button
          type="button"
          className="gallery-playpause"
          aria-pressed={playing}
          aria-label={playing ? "pause clip" : "play clip"}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? "❚❚" : "►"}
        </button>

        <button
          type="button"
          className="gallery-arrow gallery-arrow--next"
          onClick={() => go(1)}
          aria-label="next clip"
        >
          ›
        </button>
      </div>

      <p className="gallery-caption" aria-live="polite">
        {items[active].caption}
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
