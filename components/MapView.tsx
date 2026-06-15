"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Cell = { h3: string; lat: number; lng: number; count: number; hasGame: boolean };

// CARTO's keyless *raster* dark basemap. (Their keyless vector tiles were
// retired, which is why the vector gl-style rendered black.) Raster is a single
// self-contained style — no sprite/glyph/vector-tile dependencies to fail.
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      attribution: '© <a href="https://carto.com/">CARTO</a> © OpenStreetMap contributors',
    },
  },
  layers: [{ id: "carto-dark", type: "raster", source: "carto" }],
};

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
  const h = Math.round(30 + Math.min(34, Math.sqrt(cell.count) * 8));
  const w = Math.round(h * 1.5);
  const fill = cell.hasGame ? "#1f8a3b" : "#f5c518";
  const ink = cell.hasGame ? "#ffffff" : "#1a1407";
  const stripe = cell.hasGame ? "rgba(255,255,255,.85)" : "rgba(26,20,7,.55)";
  el.style.cssText = `width:${w}px;height:${h}px;cursor:pointer;transition:transform .12s;
    filter:drop-shadow(0 2px 6px rgba(0,0,0,.55));`;
  // a football: pointed oval, two white end-stripes, count where the laces sit
  el.innerHTML = `<svg viewBox="0 0 150 100" width="${w}" height="${h}" style="display:block;overflow:visible">
    <path d="M6,50 Q75,1 144,50 Q75,99 6,50 Z" fill="${fill}" stroke="rgba(255,255,255,.3)" stroke-width="3"/>
    <path d="M26,33 Q20,50 26,67" fill="none" stroke="${stripe}" stroke-width="4" stroke-linecap="round"/>
    <path d="M124,33 Q130,50 124,67" fill="none" stroke="${stripe}" stroke-width="4" stroke-linecap="round"/>
    <text x="75" y="51" text-anchor="middle" dominant-baseline="central"
      font-family="var(--font-barlow),system-ui,sans-serif" font-weight="700"
      font-size="46" fill="${ink}">${cell.count}</text>
  </svg>`;
  el.title = cell.hasGame ? `${cell.count} interested · game scheduled` : `${cell.count} interested`;
  el.onmouseenter = () => { el.style.transform = "scale(1.1)"; };
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
    // guard against the container sizing after init (flex/vh layouts)
    map.on("load", () => map.resize());
    // the map canvas can mount before the container has its final size (vh/flex
    // layouts hydrate late) — keep it filling the box whenever the box resizes.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(ref.current);

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
      ro.disconnect();
      markersRef.current.forEach((m) => m.remove());
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
}
