"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { NearbyArtisanResult } from "@/lib/constants";
import { DISCOVERY_RADIUS_METERS, formatDistanceMeters } from "@/lib/location";

interface NearbyArtisansMapProps {
  center: { lat: number; lng: number };
  artisans: NearbyArtisanResult[];
  selectedArtisanId: string | null;
  onSelectArtisan?: (artisanId: string) => void;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function NearbyArtisansMap({
  center,
  artisans,
  selectedArtisanId,
  onSelectArtisan,
}: NearbyArtisansMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom: 12,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 18,
    }).addTo(map);

    mapRef.current = map;
    layerGroupRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
    // Initialize map once; updates handled in the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();
    map.setView([center.lat, center.lng], 12, { animate: true });

    // 10 km discovery radius ring
    L.circle([center.lat, center.lng], {
      radius: DISCOVERY_RADIUS_METERS,
      color: "#0B6E4F",
      weight: 1.5,
      fillColor: "#0B6E4F",
      fillOpacity: 0.06,
    }).addTo(group);

    // Search center marker (rounded ~100m, never exact customer address)
    const userIcon = L.divIcon({
      className: "",
      html: `<div style="width:16px;height:16px;border-radius:9999px;background:#111827;border:3px solid #ffffff;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    L.marker([center.lat, center.lng], { icon: userIcon })
      .bindPopup("<strong>Your approximate search area</strong><br/>Rounded to ~100 m")
      .addTo(group);

    // Verified Online artisans within 10 km
    for (const artisan of artisans) {
      const isSelected = artisan.artisan_id === selectedArtisanId;
      const bg = isSelected ? "#D97706" : "#0B6E4F";
      const artisanIcon = L.divIcon({
        className: "",
        html: `<div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;background:${bg};color:#fff;font-weight:700;font-size:12px;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35);">★</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const ratingLabel =
        artisan.rating_count > 0
          ? `${artisan.rating_avg.toFixed(1)} ★ (${artisan.rating_count})`
          : "New verified artisan";

      const popupHtml = `
        <div style="font-family:system-ui,sans-serif;font-size:12px;line-height:1.4;">
          <strong>${escapeHtml(artisan.full_name)}</strong><br/>
          <span style="color:#4b5563;">${escapeHtml(formatDistanceMeters(artisan.distance_meters))}</span><br/>
          <span style="color:#0B6E4F;font-weight:600;">${escapeHtml(ratingLabel)}</span>
        </div>
      `;

      const marker = L.marker([artisan.approx_lat, artisan.approx_lng], {
        icon: artisanIcon,
      }).bindPopup(popupHtml);

      marker.on("click", () => {
        onSelectArtisan?.(artisan.artisan_id);
      });

      marker.addTo(group);
      if (isSelected) {
        marker.openPopup();
      }
    }
  }, [center, artisans, selectedArtisanId, onSelectArtisan]);

  return (
    <div
      ref={containerRef}
      aria-label="Map of nearby verified online artisans"
      className="h-72 w-full overflow-hidden rounded-2xl border border-gray-200 bg-gray-100 sm:h-80"
    />
  );
}
