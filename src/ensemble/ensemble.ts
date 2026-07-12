// ============================================================
// METEONEXUS - WEATHER ENSEMBLE ENGINE
// Single source of truth: model list, weights, thresholds, all blend math
// ============================================================

import {
  ENSEMBLE_MODELS,
  ENSEMBLE_WEIGHTS,
  ENSEMBLE_LABELS,
  ENSEMBLE_THRESHOLDS,
  EnsembleModel
} from './config.js';

/**
 * Interface for ensemble model arrays
 */
export interface ModelArrays {
  [key: string]: (number | null)[] | null;
}

/**
 * Interface for weighted value result
 */
export interface WeightedValueResult {
  value: number | null;
  modelsReporting: number;
}

/**
 * Interface for code agreement result
 */
export interface CodeAgreementResult {
  code: number | null;
  agreementPct: number;
  agreeingCount: number;
  modelsReporting: number;
}

/**
 * Interface for health check result
 */
export interface HealthResult {
  healthy: boolean;
  coveragePct: number;
}

/**
 * Interface for temperature band result
 */
export interface TempBandResult {
  min: number;
  max: number;
  spread: number;
}

/**
 * Interface for wetness result
 */
export interface WetnessResult {
  pct: number;
  modelsReporting: number;
  valid: boolean;
}

/**
 * WeatherEnsemble - Core ensemble engine
 * Every wet/dry decision in the app goes through classifyWetness()
 */
export class WeatherEnsemble {
  models: EnsembleModel[] = ENSEMBLE_MODELS;
  weights = ENSEMBLE_WEIGHTS;
  labels = ENSEMBLE_LABELS;
  WET_THRESHOLD_MM = ENSEMBLE_THRESHOLDS.WET_THRESHOLD_MM;
  WET_POSSIBLE_PCT = ENSEMBLE_THRESHOLDS.WET_POSSIBLE_PCT;
  WET_LIKELY_PCT = ENSEMBLE_THRESHOLDS.WET_LIKELY_PCT;
  HEALTH_DEGRADED_PCT = ENSEMBLE_THRESHOLDS.HEALTH_DEGRADED_PCT;
  HEALTH_DOWN_PCT = ENSEMBLE_THRESHOLDS.HEALTH_DOWN_PCT;

  /**
   * Extract model-specific arrays from hourly data
   * Open-Meteo suffixes every hourly field when >1 model requested
   * e.g. temperature_2m → temperature_2m_ecmwf_ifs025, temperature_2m_gfs_seamless, ...
   */
  extractModelArrays(hourly: Record<string, unknown>, varName: string): ModelArrays {
    const out: ModelArrays = {};
    for (const m of this.models) {
      out[m] = (hourly[`${varName}_${m}`] as (number | null)[]) || null;
    }
    return out;
  }

  /**
   * Coverage-aware health: partial degradation reads as degraded, not healthy
   */
  checkHealth(arr: (number | null)[] | null): HealthResult {
    if (!arr || !Array.isArray(arr) || arr.length === 0) return { healthy: false, coveragePct: 0 };
    let valid = 0;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] !== null && arr[i] !== undefined) valid++;
    }
    const coveragePct = (valid / arr.length) * 100;
    return { healthy: coveragePct >= this.HEALTH_DEGRADED_PCT, coveragePct };
  }

  /**
   * Weighted average at one time index
   * Null models are excluded — weight renormalizes over whoever reported
   * A null is never a zero vote
   */
  weightedValueAt(modelArrays: ModelArrays, idx: number): WeightedValueResult {
    let sum = 0, weightSum = 0, count = 0;
    for (const m of this.models) {
      const v = modelArrays[m] ? modelArrays[m][idx] : null;
      if (v === null || v === undefined) continue;
      const w = this.weights[m];
      sum += v * w; weightSum += w; count++;
    }
    if (count === 0) return { value: null, modelsReporting: 0 };
    return { value: sum / weightSum, modelsReporting: count };
  }

  /**
   * Weighted circular mean for direction variables (degrees)
   * Same null exclusion as weightedValueAt
   */
  weightedCircularMeanAt(modelArrays: ModelArrays, idx: number): number | null {
    let sx = 0, sy = 0, weightSum = 0, count = 0;
    for (const m of this.models) {
      const v = modelArrays[m] ? modelArrays[m][idx] : null;
      if (v === null || v === undefined) continue;
      const w = this.weights[m];
      const rad = v * (Math.PI / 180);
      sx += Math.cos(rad) * w;
      sy += Math.sin(rad) * w;
      weightSum += w; count++;
    }
    if (count === 0) return null;
    let deg = Math.atan2(sy / weightSum, sx / weightSum) * (180 / Math.PI);
    if (deg < 0) deg += 360;
    return deg;
  }

  /**
   * Min/max spread across reporting models at one index
   * Feeds temp confidence band
   */
  bandAt(modelArrays: ModelArrays, idx: number): TempBandResult | null {
    let min = Infinity, max = -Infinity, count = 0;
    for (const m of this.models) {
      const v = modelArrays[m] ? modelArrays[m][idx] : null;
      if (v === null || v === undefined) continue;
      if (v < min) min = v;
      if (v > max) max = v;
      count++;
    }
    if (count === 0) return null;
    return { min, max, spread: max - min };
  }

  /**
   * Weighted wetness consensus 0-100 at one index
   * Replaces binary vote-counting — continuous, null-aware
   */
  weightedWetnessAt(modelArrays: ModelArrays, idx: number): WetnessResult {
    let wetWeight = 0, totalWeight = 0, modelsReporting = 0;
    for (const m of this.models) {
      const v = modelArrays[m] ? modelArrays[m][idx] : null;
      if (v === null || v === undefined) continue;
      const w = this.weights[m];
      totalWeight += w; modelsReporting++;
      if (v > this.WET_THRESHOLD_MM) wetWeight += w;
    }
    if (totalWeight === 0) return { pct: 0, modelsReporting: 0, valid: false };
    return { pct: (wetWeight / totalWeight) * 100, modelsReporting, valid: true };
  }

  /**
   * Weighted majority vote for categorical fields (WMO weather_code)
   */
  weightedMajorityAt(modelArrays: ModelArrays, idx: number): CodeAgreementResult {
    const tally = new Map<number, { weight: number; count: number }>();
    let totalWeight = 0, modelsReporting = 0;
    for (const m of this.models) {
      const v = modelArrays[m] ? modelArrays[m][idx] : null;
      if (v === null || v === undefined) continue;
      const w = this.weights[m];
      const entry = tally.get(v) || { weight: 0, count: 0 };
      entry.weight += w; entry.count += 1;
      tally.set(v, entry);
      totalWeight += w; modelsReporting++;
    }
    if (totalWeight === 0) return { code: null, agreementPct: 0, agreeingCount: 0, modelsReporting: 0 };
    let bestCode = null, bestWeight = -1, bestCount = 0;
    for (const [code, entry] of tally.entries()) {
      if (entry.weight > bestWeight) { bestWeight = entry.weight; bestCode = code; bestCount = entry.count; }
    }
    return { code: bestCode, agreementPct: (bestWeight / totalWeight) * 100, agreeingCount: bestCount, modelsReporting };
  }

  /**
   * THE single wet/dry classifier used by dashboard, chart, and route timeline
   */
  classifyWetness(pct: number): 'RAIN_LIKELY' | 'RAIN_POSSIBLE' | 'STABLE' {
    if (pct >= this.WET_LIKELY_PCT)   return 'RAIN_LIKELY';
    if (pct >= this.WET_POSSIBLE_PCT) return 'RAIN_POSSIBLE';
    return 'STABLE';
  }
}

// Export singleton instance
export const ensemble = new WeatherEnsemble();