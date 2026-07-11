"use client";

import { useEffect, useRef, useState } from "react";

type Item = { title: string; caption: string; src: string };

/**
 * The "see it in action" clip grid. Client-side so it can honour WCAG 2.2.2
 * (Pause, Stop, Hide): the clips loop indefinitely, so we only autoplay when the
 * viewer hasn't asked for reduced motion, and we always offer a play/pause
 * toggle. Reduced-motion viewers see the poster frame until they hit play.
 */
export default function Gallery({ items }: { items: Item[] }) {
  const videos = useRef<Array<HTMLVideoElement | null>>([]);
  // Start paused; an effect flips this on once we know the motion preference,
  // so reduced-motion viewers never see a frame of movement.
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) setPlaying(true);
  }, []);

  useEffect(() => {
    for (const v of videos.current) {
      if (!v) continue;
      if (playing) v.play().catch(() => {});
      else v.pause();
    }
  }, [playing]);

  return (
    <>
      <div className="gallery-head">
        <h2>see it in action</h2>
        <button
          type="button"
          className="gallery-toggle"
          aria-pressed={playing}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? "⏸ pause" : "▶ play"}
        </button>
      </div>
      <div className="gallery">
        {items.map((g, i) => (
          <figure className="gallery-item" key={g.src}>
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
            <figcaption>
              <span className="gallery-title">{g.title}</span>
              <span className="gallery-caption">{g.caption}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </>
  );
}
