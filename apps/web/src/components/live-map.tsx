'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker } from 'leaflet';
import 'leaflet/dist/leaflet.css';

type Point = { lat: number; lng: number };

const pin = (emoji: string, bg: string) =>
  `<div style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:9999px;background:${bg};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);font-size:20px">${emoji}</div>`;

/**
 * Mapa do acompanhamento: motoboy ao vivo e, se o cliente permitir, a posição dele.
 * A posição do cliente fica só no navegador dele (não é enviada a ninguém).
 * Mapa: OpenStreetMap via Leaflet (sem chave de API).
 */
export function LiveMap({ courier, courierName }: { courier: Point; courierName: string | null }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const courierMarker = useRef<Marker | null>(null);
  const meMarker = useRef<Marker | null>(null);
  const L = useRef<typeof import('leaflet') | null>(null);
  const [me, setMe] = useState<Point | null>(null);
  const [meState, setMeState] = useState<'idle' | 'asking' | 'denied'>('idle');
  const fitted = useRef(false);

  // Cria o mapa uma vez.
  useEffect(() => {
    let cancelled = false;
    void import('leaflet').then((leaflet) => {
      if (cancelled || !box.current || map.current) return;
      L.current = leaflet;
      map.current = leaflet.map(box.current, { zoomControl: true, attributionControl: true }).setView([courier.lat, courier.lng], 15);
      leaflet
        .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap',
        })
        .addTo(map.current);
      courierMarker.current = leaflet
        .marker([courier.lat, courier.lng], { icon: leaflet.divIcon({ html: pin('🛵', '#e4572e'), className: '', iconSize: [40, 40], iconAnchor: [20, 20] }) })
        .addTo(map.current)
        .bindTooltip(courierName ?? 'Entregador');
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move o motoboy a cada atualização.
  useEffect(() => {
    courierMarker.current?.setLatLng([courier.lat, courier.lng]);
    if (!me && map.current) map.current.panTo([courier.lat, courier.lng]);
  }, [courier.lat, courier.lng, me]);

  // Mostra o cliente e enquadra os dois na primeira vez.
  useEffect(() => {
    if (!me || !map.current || !L.current) return;
    if (!meMarker.current) {
      meMarker.current = L.current
        .marker([me.lat, me.lng], { icon: L.current.divIcon({ html: pin('🏠', '#10b981'), className: '', iconSize: [40, 40], iconAnchor: [20, 20] }) })
        .addTo(map.current)
        .bindTooltip('Você');
    } else {
      meMarker.current.setLatLng([me.lat, me.lng]);
    }
    if (!fitted.current) {
      map.current.fitBounds(L.current.latLngBounds([[me.lat, me.lng], [courier.lat, courier.lng]]), { padding: [40, 40], maxZoom: 16 });
      fitted.current = true;
    }
  }, [me, courier.lat, courier.lng]);

  function showMe() {
    if (!navigator.geolocation) return setMeState('denied');
    setMeState('asking');
    navigator.geolocation.watchPosition(
      (p) => {
        setMe({ lat: p.coords.latitude, lng: p.coords.longitude });
        setMeState('idle');
      },
      () => setMeState('denied'),
      { enableHighAccuracy: true, maximumAge: 30_000 },
    );
  }

  return (
    <div className="space-y-2">
      <div ref={box} className="h-72 w-full overflow-hidden rounded-xl border border-zinc-200" aria-label="Mapa do entregador" />
      {!me && (
        <button className="text-sm text-[var(--brand)] underline" onClick={showMe} disabled={meState === 'asking'}>
          {meState === 'asking' ? 'Localizando você...' : meState === 'denied' ? 'Não foi possível pegar sua localização' : 'Mostrar minha localização no mapa'}
        </button>
      )}
    </div>
  );
}
