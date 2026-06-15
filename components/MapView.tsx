"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Cell = { h3: string; lat: number; lng: number; count: number; hasGame: boolean };

const STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** map zoom → H3 resolution. Coarser when zoomed out (cells merge), finer when
 *  zoomed in (cells split) — the "groups collapse in and out" effect. */
function resForZoom(z: number): number {
  if (z < 5) return 3;
  if (z < 7) return 4;
  if (z < 9) return 5;
  if (z < 11) return 6;
  return 7;
}

function bubble(cell: Cell): HTMLElement {
  const el = document.createElement("div");
  const size = Math.round(30 + Math.min(36, Math.sqrt(cell.count) * 9));
  const accent = cell.hasGame ? "#1f8a3b" : "#f5c518";
  const ink = cell.hasGame ? "#fff" : "#1a1407";
  el.style.cssText = `
    width:${size}px;height:${size}px;border-radius:50%;
    background:${accent};color:${ink};
    display:flex;align-items:center;justify-content:center;
    font:600 ${Math.round(size / 2.8)}px/1 var(--font-barlow),system-ui,sans-serif;
    box-shadow:0 2px 10px rgba(0,0,0,.5);border:2px solid rgba(255,255,255,.18);
    cursor:pointer;transition:transform .12s;`;
  el.textContent = String(cell.count);
  el.title = cell.hasGame ? `${cell.count} interested · game scheduled` : `${cell.count} interested`;
  el.onmouseenter = () => { el.style.transform = "scale(1.08)"; };
  el.onmouseleave = () => { el.style.transform = "scale(1)"; };
  return el;
}

export function MapView({ center, zoom = 9 }: { center: [number, number]; zoom?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: STYLE,
      center,
      zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    let aborted = false;
    async function refresh() {
      const res = resForZoom(map.getZoom());
      const r = await fetch(`/api/map?res=${res}`, { cache: "no-store" });
      if (aborted || !r.ok) return;
      const { cells } = (await r.json()) as { cells: Cell[] };
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = cells.map((c) =>
        new maplibregl.Marker({ element: bubble(c) }).setLngLat([c.lng, c.lat]).addTo(map)
      );
    }

    // markers are DOM overlays — fetch immediately, don't wait on tile load
    void refresh();
    map.on("moveend", refresh);

    return () => {
      aborted = true;
      markersRef.current.forEach((m) => m.remove());
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
}
