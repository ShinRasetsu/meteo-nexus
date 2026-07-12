// ============================================================
// METEONEXUS - FUEL MANAGER
// ============================================================

import { FUEL_CATALOG, BRAND_LINKS, VARIANT_OSM_MAP } from './fuelCatalog.js';
import { processOverpassPayload } from './overpassProcessor.js';
import { fastDistance } from '../utils/math.js';

const STORAGE_KEY = 'meteo_fuel_prefs';

export interface FuelConfig {
  brand: string;
  variant: string;
  avoidTolls: boolean;
  avoidHighways: boolean;
  avoidFerries: boolean;
}

const DEFAULT_CONFIG: FuelConfig = {
  brand: 'Shell',
  variant: 'V-Power Racing',
  avoidTolls: false,
  avoidHighways: false,
  avoidFerries: false
};

export interface FuelStationResult {
  lat: number;
  lon: number;
  name: string;
  dist: string;
  isExact: boolean;
  strictFilterActive: boolean;
}

export class FuelManager {
  private memoryConfig: FuelConfig = { brand: 'Shell', variant: 'V-Power Racing', avoidTolls: false, avoidHighways: false, avoidFerries: false };
  private _isInitialized = false;

  async loadConfig(): Promise<void> {
    try {
      const stored = localStorage.getItem('meteo_fuel_prefs');
      if (stored) this.memoryConfig = { ...this.memoryConfig, ...JSON.parse(stored) };
    } catch (e) { console.warn("Storage fetch failed. Using hard defaults.", e); }
  }

  getConfig(): FuelConfig { return this.memoryConfig; }

  async saveConfig(conf: FuelConfig): Promise<void> {
    this.memoryConfig = conf;
    try { await localStorage.setItem('meteo_fuel_prefs', JSON.stringify(conf)); } catch(e) { console.error("Config save failed", e); }
  }

  findAllAlongRoute(lat: number, lon: number, routeNodes: { lat: number; lon: number; passed: boolean }[]): Promise<{ stations: FuelStationResult[]; isStrict: boolean }> {
    const conf = this.getConfig();
    let upcoming: any[] = [];
    for (let i = 0; i < routeNodes.length; i++) if (!routeNodes[i].passed) upcoming.push(routeNodes[i]);
    if (upcoming.length === 0) return this.findAllNearest(lat, lon);
    let sampled: any[] = [], step = Math.max(1, Math.floor(upcoming.length / 15));
    for(let i=0; i<upcoming.length; i+=step) sampled.push(upcoming[i]);
    if(sampled[sampled.length-1] !== upcoming[upcoming.length-1]) sampled.push(upcoming[upcoming.length-1]);
    const cacheKey = `fuel_route_all_${conf.brand}_${sampled[0].lat.toFixed(2)}_${sampled[0].lon.toFixed(2)}`;
    try { const cached = localStorage.getItem(cacheKey); if (cached && (Date.now() - JSON.parse(cached).timestamp < 3600000)) return JSON.parse(cached).data; } catch(e) {}
    let queryParts: string[] = [];
    sampled.forEach(node => {
      queryParts.push(`node["amenity"="fuel"]["brand"~"${conf.brand}",i](around:3500,${node.lat},${node.lon});`);
      queryParts.push(`way["amenity"="fuel"]["brand"~"${conf.brand}",i](around:3500,${node.lat},${node.lon});`);
    });
    const query = `[out:json][timeout:25];(${queryParts.join('')});out center;`;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
      const data = await res.json();
      const processedData = await import('./overpassProcessor.js').then(m => m.processOverpassPayload(data, lat, lon, conf.brand, conf.variant, VARIANT_OSM_MAP));
      localStorage.setItem(cacheKey, JSON.stringify({ data: processedData, timestamp: Date.now() }));
      return processedData;
    } catch(e) { return { stations: [], isStrict: false }; }
  }

  findAllNearest(lat: number, lon: number): Promise<{ stations: FuelStationResult[]; isStrict: boolean }> {
    const conf = this.getConfig();
    const cacheKey = `fuel_nearest_all_${conf.brand}_${lat.toFixed(2)}_${lon.toFixed(2)}`;
    try { const cached = localStorage.getItem(cacheKey); if (cached && (Date.now() - JSON.parse(cached).timestamp < 86400000)) return JSON.parse(cached).data; } catch(e) {}
    const query = `[out:json][timeout:15];(node["amenity"="fuel"]["brand"~"${conf.brand}",i](around:20000,${lat},${lon});way["amenity"="fuel"]["brand"~"${conf.brand}",i](around:20000,${lat},${lon}););out center;`;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const data = await res.json();
      const processedData = await import('./overpassProcessor.js').then(m => m.processOverpassPayload(data, lat, lon, conf.brand, conf.variant, VARIANT_OSM_MAP));
      localStorage.setItem(cacheKey, JSON.stringify({ data: processedData, timestamp: Date.now() }));
      return processedData;
    } catch(e) { return { stations: [], isStrict: false }; }
  }
}

export interface FuelConfig {
  brand: string;
  variant: string;
  avoidTolls: boolean;
  avoidHighways: boolean;
  avoidFerries: boolean;
}

export interface FuelStationResult {
  lat: number;
  lon: number;
  name: string;
  dist: string;
  isExact: boolean;
  strictFilterActive: boolean;
}