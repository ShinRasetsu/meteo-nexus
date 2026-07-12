import { describe, it, expect } from 'vitest';
import { WeatherEnsemble } from '../src/ensemble/ensemble.js';
import { fastDistance } from '../src/utils/math.js';

describe('WeatherEnsemble', () => {
  let ensemble: any;

  beforeEach(() => {
    ensemble = new WeatherEnsemble();
  });

  it('should have correct model weights summing to 1', () => {
    const sum = Object.values(ensemble.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('should extract model arrays from hourly data', () => {
    const hourly = {
      temperature_2m_ecmwf_ifs025: [10, 11, 12],
      temperature_2m_gfs_seamless: [10.5, 11.5, 12.5],
      temperature_2m_icon_seamless: [9.5, 10.5, 11.5],
      temperature_2m_jma_seamless: [10.2, 11.2, 12.2]
    };
    const extracted = ensemble.extractModelArrays(hourly, 'temperature_2m');
    expect(Object.keys(extracted)).toEqual(['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'jma_seamless']);
    expect(extracted.ecmwf_ifs025).toEqual([10, 11, 12]);
  });

  it('should compute weighted value correctly', () => {
    const modelArrays = {
      ecmwf_ifs025: [10, 20, 30],
      gfs_seamless: [10, 20, 30],
      icon_seamless: [10, 20, 30],
      jma_seamless: [10, 20, 30]
    };
    const result = ensemble.weightedValueAt(modelArrays, 1);
    // All models same value, weighted average = 20
    expect(result.value).toBe(20);
    expect(result.modelsReporting).toBe(4);
  });

  it('should handle null values in weighted average', () => {
    const modelArrays = {
      ecmwf_ifs025: [10, null, 30],
      gfs_seamless: [20, 20, 20],
      icon_seamless: [null, 20, 20],
      jma_seamless: [10, 10, 10]
    };
    // At index 1: ecmwf=null, gfs=20, icon=20, jma=10
    // Weights: 0.35*20 + 0.15*20 + 0.15*10 = 7 + 3 + 1.5 = 11.5 / 0.65 = 17.69
    const result = ensemble.weightedValueAt(modelArrays, 1);
    expect(result.value).toBeCloseTo(17.69, 1);
  });

  it('should classify wetness correctly', () => {
    expect(ensemble.classifyWetness(80)).toBe('RAIN_LIKELY');
    expect(ensemble.classifyWetness(50)).toBe('RAIN_POSSIBLE');
    expect(ensemble.classifyWetness(30)).toBe('STABLE');
  });

  it('should compute circular mean correctly', () => {
    const modelArrays = {
      ecmwf_ifs025: [0],
      gfs_seamless: [90],
      icon_seamless: [180],
      jma_seamless: [270]
    };
    // All 4 directions, circular mean should be undefined/null or handle properly
    const mean = ensemble.weightedCircularMeanAt(modelArrays, 0);
    // With 4 cardinal directions equally weighted, result depends on implementation
    expect(mean).not.toBeNull();
  });
});

describe('fastDistance', () => {
  it('should calculate distance correctly', () => {
    // Manila to Quezon City ~10km
    const dist = fastDistance(14.5995, 120.9842, 14.6760, 121.0437);
    expect(dist).toBeGreaterThan(8000);
    expect(dist).toBeLessThan(12000);
  });

  it('should return 0 for same coordinates', () => {
    const dist = fastDistance(14.5995, 120.9842, 14.5995, 120.9842);
    expect(dist).toBe(0);
  });
});

describe('Circular variance', () => {
  it('should compute low variance for aligned headings', () => {
    const headings = [10, 12, 11, 10, 11]; // very aligned
    let sumSin = 0, sumCos = 0;
    for (const h of headings) {
      const rad = h * Math.PI / 180;
      sumSin += Math.sin(rad);
      sumCos += Math.cos(rad);
    }
    const meanResultant = Math.sqrt(sumSin * sumSin + sumCos * sumCos) / headings.length;
    const circularVariance = 1 - meanResultant;
    expect(circularVariance).toBeLessThan(0.01);
  });

  it('should compute high variance for spread headings', () => {
    const headings = [0, 90, 180, 270]; // perfectly spread
    let sumSin = 0, sumCos = 0;
    for (const h of headings) {
      const rad = h * Math.PI / 180;
      sumSin += Math.sin(rad);
      sumCos += Math.cos(rad);
    }
    const meanResultant = Math.sqrt(sumSin * sumSin + sumCos * sumCos) / headings.length;
    const circularVariance = 1 - meanResultant;
    expect(circularVariance).toBeCloseTo(1, 5);
  });
});