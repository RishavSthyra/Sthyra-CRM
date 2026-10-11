"use client";

import { useMemo, useRef, useState } from "react";
import type {
  FeatureCollection,
  Geometry,
  MultiPolygon,
  Point,
  Polygon,
} from "geojson";
import type {
  FillLayerSpecification,
  HeatmapLayerSpecification,
  StyleSpecification,
} from "maplibre-gl";
import { feature as topologyFeature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { loadDistricts, states, type DistrictFeature } from "vardhan-maps/data";
import countriesTopologyJson from "world-atlas/countries-110m.json";
import MapView, {
  Layer,
  Marker,
  NavigationControl,
  Popup,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from "@vis.gl/react-maplibre";
import {
  addLeadCountsToBoundaries,
  buildLeadBoundaryCounts,
  normalizeBoundaryName,
} from "@/lib/leadBoundaryData";
import {
  buildLeadClusterIndex,
  type LeadClusterPointProperties,
} from "@/lib/leadMarkerClustering";

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

type HeatPointProperties = GeographyPoint & { weight: number };
type VisibleBounds = [number, number, number, number];

type CountryProperties = { name: string };
type WorldTopology = Topology<{
  countries: GeometryCollection<CountryProperties>;
}>;

const worldTopology = countriesTopologyJson as unknown as WorldTopology;
const worldCountries = topologyFeature<CountryProperties>(
  worldTopology,
  worldTopology.objects.countries,
) as FeatureCollection<Polygon | MultiPolygon, CountryProperties>;

const darkMapStyle: StyleSpecification = {
  version: 8,
  sources: {
    openstreetmap: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    {
      id: "openstreetmap",
      type: "raster",
      source: "openstreetmap",
      minzoom: 0,
      maxzoom: 20,
    },
  ],
};

const heatLayer: HeatmapLayerSpecification = {
  id: "lead-heat",
  type: "heatmap",
  source: "lead-geography",
  maxzoom: 12,
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
    "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1.2, 10, 3],
    "heatmap-color": [
      "interpolate",
      ["linear"],
      ["heatmap-density"],
      0,
      "rgba(0,0,0,0)",
      0.15,
      "rgba(0,0,0,0.18)",
      0.4,
      "rgba(0,0,0,0.42)",
      0.72,
      "rgba(0,0,0,0.72)",
      1,
      "rgba(0,0,0,1)",
    ],
    "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 20, 6, 38, 11, 62],
    "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.95, 12, 0.2],
  },
};

function boundaryLayer(
  id: string,
  source: string,
  minzoom: number,
  maxzoom: number,
): FillLayerSpecification {
  return {
    id,
    type: "fill",
    source,
    minzoom,
    maxzoom,
    paint: {
      "fill-color": "#000000",
      "fill-opacity": [
        "interpolate",
        ["linear"],
        ["get", "weight"],
        0,
        0.22,
        1,
        0.7,
      ],
      "fill-outline-color": "#111111",
    },
  };
}

const countryLayer = boundaryLayer("lead-countries-fill", "lead-countries", 0, 3.8);
const stateLayer = boundaryLayer("lead-states-fill", "lead-states", 3, 7.8);
const districtLayer = boundaryLayer("lead-districts-fill", "lead-districts", 5.8, 12);

function zoomForPrecision(precision: GeographyPoint["precision"]) {
  if (precision === "country") return 4.2;
  if (precision === "state") return 6.2;
  if (precision === "district") return 8.2;
  return 10.5;
}

function levelForZoom(zoom: number) {
  if (zoom < 3.2) return "Country";
  if (zoom < 5.8) return "State";
  if (zoom < 8.8) return "District";
  return "City";
}

function geometryBounds(geometry: Geometry) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  function visit(value: unknown) {
    if (!Array.isArray(value)) return;
    if (
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      west = Math.min(west, value[0]);
      east = Math.max(east, value[0]);
      south = Math.min(south, value[1]);
      north = Math.max(north, value[1]);
      return;
    }
    value.forEach(visit);
  }

  if ("coordinates" in geometry) visit(geometry.coordinates);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  return [[west, south], [east, north]] as [[number, number], [number, number]];
}

function visibleMapBounds(map: {
  getBounds(): {
    getWest(): number;
    getEast(): number;
    getSouth(): number;
    getNorth(): number;
  };
}): VisibleBounds {
  const bounds = map.getBounds();
  const west = Math.max(-180, bounds.getWest());
  const east = Math.min(180, bounds.getEast());
  const south = Math.max(-85, bounds.getSouth());
  const north = Math.min(85, bounds.getNorth());

  if (east <= west) return [-180, south, 180, north];
  return [west, south, east, north];
}

export function LeadGeographyMap({
  mappedLeads,
  points,
  unmappedLeads,
}: Props) {
  const mapRef = useRef<MapRef>(null);
  const districtCache = useRef(new Map<string, DistrictFeature[]>());
  const districtRequest = useRef(0);
  const [zoom, setZoom] = useState(1.25);
  const [visibleBounds, setVisibleBounds] = useState<VisibleBounds>([
    -180,
    -85,
    180,
    85,
  ]);
  const [selected, setSelected] = useState<GeographyPoint | null>(null);
  const [activeState, setActiveState] = useState<string | null>(null);
  const [districts, setDistricts] = useState<DistrictFeature[]>([]);
  const [districtLoading, setDistrictLoading] = useState(false);
  const [districtError, setDistrictError] = useState(false);
  const maxLeads = Math.max(1, ...points.map((point) => point.leads));

  const pointData = useMemo<FeatureCollection<Point, HeatPointProperties>>(
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
  const clusterIndex = useMemo(
    () => buildLeadClusterIndex(points),
    [points],
  );
  const visibleMarkers = useMemo(
    () => clusterIndex.getClusters(visibleBounds, Math.floor(zoom)),
    [clusterIndex, visibleBounds, zoom],
  );
  const countryAreas = useMemo(
    () =>
      addLeadCountsToBoundaries(
        worldCountries.features,
        buildLeadBoundaryCounts(points, "country"),
      ),
    [points],
  );
  const stateAreas = useMemo(
    () =>
      addLeadCountsToBoundaries(
        states.features,
        buildLeadBoundaryCounts(
          points.filter((point) => normalizeBoundaryName(point.country) === "india"),
          "state",
        ),
      ),
    [points],
  );
  const districtAreas = useMemo(
    () =>
      addLeadCountsToBoundaries(
        districts,
        buildLeadBoundaryCounts(points, "district", activeState),
      ),
    [activeState, districts, points],
  );

  async function loadStateDistricts(stateName: string) {
    const key = normalizeBoundaryName(stateName);
    const cached = districtCache.current.get(key);
    setActiveState(stateName);
    setDistrictError(false);
    if (cached) {
      setDistricts(cached);
      return;
    }

    const request = ++districtRequest.current;
    setDistricts([]);
    setDistrictLoading(true);
    try {
      const loaded = await loadDistricts(stateName, { resolution: "low" });
      districtCache.current.set(key, loaded);
      if (request === districtRequest.current) setDistricts(loaded);
    } catch (error) {
      console.error("Unable to load district boundaries", error);
      if (request === districtRequest.current) setDistrictError(true);
    } finally {
      if (request === districtRequest.current) setDistrictLoading(false);
    }
  }

  function focusPoint(point: GeographyPoint) {
    setSelected(point);
    if (point.state && normalizeBoundaryName(point.country) === "india") {
      void loadStateDistricts(point.state);
    }
    mapRef.current?.flyTo({
      center: [point.longitude, point.latitude],
      zoom: zoomForPrecision(point.precision),
      duration: 900,
    });
  }

  function handleMapClick(event: MapLayerMouseEvent) {
    const boundary = event.features?.[0];
    if (!boundary) return;
    const name = String(boundary.properties?.name ?? "");
    if (!name) return;

    if (boundary.layer.id === countryLayer.id) {
      const countryPoints = points.filter(
        (point) => normalizeBoundaryName(point.country) === normalizeBoundaryName(name),
      );
      if (!countryPoints.length) return;
      const leadTotal = countryPoints.reduce((total, point) => total + point.leads, 0);
      const longitude = countryPoints.reduce(
        (total, point) => total + point.longitude * point.leads,
        0,
      ) / leadTotal;
      const latitude = countryPoints.reduce(
        (total, point) => total + point.latitude * point.leads,
        0,
      ) / leadTotal;
      setActiveState(null);
      setDistricts([]);
      setSelected(null);
      mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 4.2, duration: 900 });
      return;
    }

    const bounds = geometryBounds(boundary.geometry);
    if (boundary.layer.id === stateLayer.id) {
      setSelected(null);
      void loadStateDistricts(name);
      if (bounds) {
        mapRef.current?.fitBounds(bounds, {
          duration: 900,
          maxZoom: 6.8,
          padding: 36,
        });
      }
      return;
    }

    if (boundary.layer.id === districtLayer.id) {
      const matchingPoint = points.find(
        (point) =>
          normalizeBoundaryName(point.state) === normalizeBoundaryName(activeState) &&
          normalizeBoundaryName(point.district) === normalizeBoundaryName(name),
      );
      if (matchingPoint) setSelected(matchingPoint);
      if (bounds) {
        mapRef.current?.fitBounds(bounds, {
          duration: 900,
          maxZoom: 10.2,
          padding: 42,
        });
      }
    }
  }

  return (
    <div className="grid min-h-[430px] grid-cols-[minmax(0,1fr)_340px] max-[1050px]:grid-cols-1">
      <div className="lead-geography-map relative min-h-[430px] border-r border-white/10 max-[1050px]:border-r-0 max-[1050px]:border-b">
        <MapView
          initialViewState={{ latitude: 18, longitude: 12, zoom: 1.25 }}
          interactiveLayerIds={[countryLayer.id, stateLayer.id, districtLayer.id]}
          mapStyle={darkMapStyle}
          maxZoom={15}
          minZoom={1}
          onClick={handleMapClick}
          onMoveEnd={(event) => {
            setZoom(event.viewState.zoom);
            setVisibleBounds(visibleMapBounds(event.target));
          }}
          ref={mapRef}
          reuseMaps
          style={{ height: "100%", minHeight: 430, width: "100%" }}
        >
          <NavigationControl position="top-right" showCompass={false} />
          <Source data={countryAreas} id="lead-countries" type="geojson">
            <Layer {...countryLayer} />
          </Source>
          <Source data={stateAreas} id="lead-states" type="geojson">
            <Layer {...stateLayer} />
          </Source>
          <Source data={districtAreas} id="lead-districts" type="geojson">
            <Layer {...districtLayer} />
          </Source>
          <Source data={pointData} id="lead-geography" type="geojson">
            <Layer {...heatLayer} />
          </Source>
          {visibleMarkers.map((marker) => {
            const [longitude, latitude] = marker.geometry.coordinates;
            if ("cluster" in marker.properties && marker.properties.cluster) {
              const clusterId = marker.properties.cluster_id;
              const leadTotal = marker.properties.leads;
              const size = Math.min(52, 30 + Math.round(Math.log2(leadTotal + 1) * 3));
              return (
                <Marker
                  anchor="center"
                  key={`cluster-${clusterId}`}
                  latitude={latitude}
                  longitude={longitude}
                >
                  <button
                    aria-label={`${leadTotal} grouped leads. Zoom in to expand.`}
                    className="grid place-items-center rounded-full border border-black bg-white text-[10px] font-semibold text-black shadow-[0_0_0_4px_rgba(255,255,255,0.18),0_0_22px_rgba(255,255,255,0.5)] transition-transform hover:scale-110 focus-visible:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                    onClick={(event) => {
                      event.stopPropagation();
                      const expansionZoom = clusterIndex.getClusterExpansionZoom(clusterId);
                      mapRef.current?.easeTo({
                        center: [longitude, latitude],
                        duration: 700,
                        zoom: Math.min(12, expansionZoom),
                      });
                    }}
                    style={{ height: size, width: size }}
                    title={`${leadTotal.toLocaleString("en-IN")} grouped leads`}
                    type="button"
                  >
                    {leadTotal.toLocaleString("en-IN")}
                  </button>
                </Marker>
              );
            }

            const pointProperties = marker.properties as LeadClusterPointProperties;
            const point = points[pointProperties.pointIndex];
            if (!point) return null;
            const size = 8 + Math.round(10 * Math.sqrt(point.leads / maxLeads));
            return (
              <Marker
                anchor="center"
                key={`${point.precision}-${point.latitude}-${point.longitude}-${point.label}`}
                latitude={latitude}
                longitude={longitude}
              >
                <button
                  aria-label={`${point.label}: ${point.leads} leads`}
                  className="rounded-full border border-black/80 bg-white shadow-[0_0_0_3px_rgba(255,255,255,0.2),0_0_18px_rgba(255,255,255,0.65)] transition-transform hover:scale-125 focus-visible:scale-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  onClick={(event) => {
                    event.stopPropagation();
                    focusPoint(point);
                  }}
                  style={{ height: size, width: size }}
                  title={`${point.label} · ${point.leads.toLocaleString("en-IN")} leads`}
                  type="button"
                />
              </Marker>
            );
          })}
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
        </MapView>
        <div className="pointer-events-none absolute top-3 left-3 border border-white/15 bg-black/80 px-3 py-2 backdrop-blur">
          <p className="text-[9px] text-[#8c8c8c]">Current detail</p>
          <p className="mt-0.5 text-[12px] font-medium text-white">
            {levelForZoom(zoom)} view
            {activeState && zoom >= 5.8 ? ` · ${activeState}` : ""}
          </p>
        </div>
        {districtLoading ? (
          <div className="pointer-events-none absolute bottom-3 left-3 border border-white/15 bg-black/80 px-3 py-2 text-[10px] text-[#bdbdbd] backdrop-blur">
            Loading district boundaries…
          </div>
        ) : null}
        {districtError ? (
          <div className="pointer-events-none absolute bottom-3 left-3 border border-white/15 bg-black/80 px-3 py-2 text-[10px] text-[#bdbdbd] backdrop-blur">
            District boundaries are unavailable for this state.
          </div>
        ) : null}
        {!points.length ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/55 px-8 text-center backdrop-blur-[2px]">
            <div>
              <p className="text-[13px] font-semibold text-white">No mapped lead locations</p>
              <p className="mt-2 max-w-sm text-[11px] leading-5 text-[#9a9a9a]">
                Add country, state, city or coordinates to lead forms to populate the map.
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
