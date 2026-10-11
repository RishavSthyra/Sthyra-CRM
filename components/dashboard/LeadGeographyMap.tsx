"use client";

import { useMemo, useRef, useState } from "react";
import type { FeatureCollection, Point } from "geojson";
import type { StyleSpecification } from "maplibre-gl";
import Map, {
  Layer,
  NavigationControl,
  Popup,
  Source,
  type CircleLayerSpecification,
  type HeatmapLayerSpecification,
  type MapLayerMouseEvent,
  type MapRef,
} from "@vis.gl/react-maplibre";

export type GeographyPoint = {
  country: string | null;
  state: string | null;
  district: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  leads: number;
  precision: "country" | "state" | "district" | "city" | "coordinates";
  label: string;
};

type Props = {
  points: GeographyPoint[];
  mappedLeads: number;
  unmappedLeads: number;
};

type SelectedPoint = GeographyPoint;

const darkMapStyle: StyleSpecification = {
  version: 8,
  sources: {
    "carto-dark": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [
    {
      id: "carto-dark",
      type: "raster",
      source: "carto-dark",
      minzoom: 0,
      maxzoom: 20,
    },
  ],
};

const heatLayer: HeatmapLayerSpecification = {
  id: "lead-heat",
  type: "heatmap",
  source: "lead-geography",
  maxzoom: 11,
  paint: {
    "heatmap-weight": [
      "interpolate",
      ["linear"],
      ["get", "weight"],
      0,
      0,
      1,
      1,
    ],
    "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.8, 10, 2.5],
    "heatmap-color": [
      "interpolate",
      ["linear"],
      ["heatmap-density"],
      0,
      "rgba(255,255,255,0)",
      0.2,
      "rgba(255,255,255,0.12)",
      0.45,
      "rgba(255,255,255,0.28)",
      0.7,
      "rgba(255,255,255,0.55)",
      1,
      "rgba(255,255,255,0.95)",
    ],
    "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 16, 5, 34, 10, 54],
    "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.9, 11, 0.15],
  },
};

const pointLayer: CircleLayerSpecification = {
  id: "lead-points",
  type: "circle",
  source: "lead-geography",
  minzoom: 1,
  paint: {
    "circle-radius": [
      "interpolate",
      ["linear"],
      ["zoom"],
      1,
      ["interpolate", ["linear"], ["get", "weight"], 0, 3, 1, 8],
      10,
      ["interpolate", ["linear"], ["get", "weight"], 0, 7, 1, 22],
    ],
    "circle-color": "#ffffff",
    "circle-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.2, 8, 0.72],
    "circle-stroke-color": "#0b0c0e",
    "circle-stroke-width": 1.5,
  },
};

function zoomForPrecision(precision: GeographyPoint["precision"]) {
  if (precision === "country") return 4.2;
  if (precision === "state") return 6.2;
  if (precision === "district") return 8.2;
  return 10.5;
}

function levelForZoom(zoom: number) {
  if (zoom < 3.2) return "World";
  if (zoom < 5.6) return "Country";
  if (zoom < 7.6) return "State";
  if (zoom < 9.6) return "District";
  return "City";
}

export function LeadGeographyMap({
  mappedLeads,
  points,
  unmappedLeads,
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const [zoom, setZoom] = useState(1.25);
  const [selected, setSelected] = useState<SelectedPoint | null>(null);
  const maxLeads = Math.max(1, ...points.map((point) => point.leads));
  const geojson = useMemo<FeatureCollection<Point>>(
    () => ({
      type: "FeatureCollection",
      features: points.map((point) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [point.longitude, point.latitude],
        },
        properties: {
          ...point,
          weight: Math.max(0.12, point.leads / maxLeads),
        },
      })),
    }),
    [maxLeads, points],
  );

  function focusPoint(point: GeographyPoint) {
    setSelected(point);
    mapRef.current?.flyTo({
      center: [point.longitude, point.latitude],
      zoom: zoomForPrecision(point.precision),
      duration: 900,
    });
  }

  function handleMapClick(event: MapLayerMouseEvent) {
    const feature = event.features?.[0];
    if (!feature || feature.geometry.type !== "Point") return;
    const properties = feature.properties as GeographyPoint;
    focusPoint({
      ...properties,
      latitude: Number(properties.latitude),
      longitude: Number(properties.longitude),
      leads: Number(properties.leads),
    });
  }

  return (
    <div className="grid min-h-[430px] grid-cols-[minmax(0,1fr)_340px] max-[1050px]:grid-cols-1">
      <div className="relative min-h-[430px] border-r border-white/10 max-[1050px]:border-r-0 max-[1050px]:border-b">
        <Map
          initialViewState={{ latitude: 18, longitude: 12, zoom: 1.25 }}
          interactiveLayerIds={["lead-points"]}
          mapStyle={darkMapStyle}
          maxZoom={15}
          minZoom={1}
          onClick={handleMapClick}
          onMoveEnd={(event) => setZoom(event.viewState.zoom)}
          ref={mapRef}
          reuseMaps
          style={{ height: "100%", minHeight: 430, width: "100%" }}
        >
          <NavigationControl position="top-right" showCompass={false} />
          <Source data={geojson} id="lead-geography" type="geojson">
            <Layer {...heatLayer} />
            <Layer {...pointLayer} />
          </Source>
          {selected ? (
            <Popup
              anchor="bottom"
              className="lead-map-popup"
              closeButton={false}
              closeOnClick={false}
              latitude={selected.latitude}
              longitude={selected.longitude}
              offset={14}
            >
              <div className="min-w-36 bg-[#101113] px-3 py-2 text-white">
                <p className="text-[11px] font-semibold">{selected.label}</p>
                <p className="mt-1 text-[10px] text-[#a5a5a5]">
                  {selected.leads.toLocaleString("en-IN")} leads · {selected.precision}
                </p>
              </div>
            </Popup>
          ) : null}
        </Map>
        <div className="pointer-events-none absolute top-3 left-3 border border-white/15 bg-black/75 px-3 py-2 backdrop-blur">
          <p className="text-[9px] text-[#8c8c8c]">Current detail</p>
          <p className="mt-0.5 text-[12px] font-medium text-white">
            {levelForZoom(zoom)} view
          </p>
        </div>
        {!points.length ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/55 px-8 text-center backdrop-blur-[2px]">
            <div>
              <p className="text-[13px] font-semibold text-white">No mapped lead locations</p>
              <p className="mt-2 max-w-sm text-[11px] leading-5 text-[#9a9a9a]">
                Add country, state, city or coordinates to lead forms to populate the heatmap.
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <aside className="min-w-0 overflow-hidden bg-[#101113] p-5 text-white">
        <div className="grid grid-cols-2 gap-px bg-white/10">
          <div className="bg-[#101113] p-3">
            <p className="text-[9px] text-[#7e7e7e]">Mapped</p>
            <strong className="mt-1 block text-xl font-medium">
              {mappedLeads.toLocaleString("en-IN")}
            </strong>
          </div>
          <div className="bg-[#101113] p-3">
            <p className="text-[9px] text-[#7e7e7e]">Unmapped</p>
            <strong className="mt-1 block text-xl font-medium">
              {unmappedLeads.toLocaleString("en-IN")}
            </strong>
          </div>
        </div>
        <p className="mt-5 border-b border-white/10 pb-2 text-[9px] font-semibold tracking-[0.08em] text-[#8a8a8a] uppercase">
          Lead concentration
        </p>
        <div className="mt-1 -mr-2 max-h-[285px] overflow-y-auto pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {points.slice(0, 12).map((point, index) => (
            <button
              className="grid w-full grid-cols-[22px_minmax(0,1fr)_auto] items-start gap-2 border-b border-white/[0.07] py-3 pr-1 text-left transition hover:bg-white/[0.04]"
              key={`${point.precision}-${point.latitude}-${point.longitude}-${point.label}`}
              onClick={() => focusPoint(point)}
              type="button"
            >
              <span className="text-[9px] text-[#666666]">{index + 1}</span>
              <span className="min-w-0">
                <span className="block text-[10px] leading-4 font-medium break-words text-[#e9e9e9]">
                  {point.label}
                </span>
                <span className="mt-0.5 block text-[8px] capitalize text-[#747474]">
                  {point.precision} precision
                </span>
              </span>
              <strong className="text-[11px] font-semibold">
                {point.leads.toLocaleString("en-IN")}
              </strong>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
