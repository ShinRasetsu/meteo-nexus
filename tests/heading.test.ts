import { describe, it, expect, beforeEach } from 'vitest';
import { WeatherEnsemble } from '../src/ensemble/ensemble.js';

describe('Heading Fusion & Calibration', () => {
  let ensemble: any;

  beforeEach(() => {
    ensemble = new WeatherEnsemble();
  });

  it('should handle heading circular difference correctly', () => {
    function headingDiff(a: number, b: number): number {
      let diff = a - b;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      return diff;
    }

    expect(headingDiff(10, 350)).toBe(20);
    expect(headingDiff(350, 10)).toBe(-20);
    expect(headingDiff(180, 10)).toBe(-170);
    expect(headingDiff(0, 359)).toBe(1);
    expect(headingDiff(1, 0)).toBe(1);
  });

  it('should apply deadband correctly', () => {
    const DEADBAND = 0.3;
    function applyDeadband(diff: number): number {
      return Math.abs(diff) >= DEADBAND ? diff : 0;
    }

    expect(applyDeadband(0.2)).toBe(0);
    expect(applyDeadband(0.3)).toBe(0.3);
    expect(applyDeadband(-0.5)).toBe(-0.5);
    expect(applyDeadband(0)).toBe(0);
  });

  it('should compute adaptive EMA lerp factor', () => {
    function lerpFactor(dt: number, tc: number): number {
      return 1 - Math.exp(-dt / tc);
    }

    // At 60fps, dt ≈ 16.67ms
    const dt = 16.67;
    
    // fused: 100ms TC -> ~15% per frame
    expect(lerpFactor(dt, 100)).toBeCloseTo(0.15, 1);
    
    // gnss: 200ms TC -> ~8% per frame
    expect(lerpFactor(dt, 200)).toBeCloseTo(0.08, 1);
    
    // imu: 500ms TC -> ~3% per frame
    expect(lerpFactor(dt, 500)).toBeCloseTo(0.03, 1);
  });

  it('should normalize heading to 0-360', () => {
    function normalize(h: number): number {
      return ((h % 360) + 360) % 360;
    }

    expect(normalize(0)).toBe(0);
    expect(normalize(360)).toBe(0);
    expect(normalize(450)).toBe(90);
    expect(normalize(-10)).toBe(350);
    expect(normalize(-360)).toBe(0);
  });

  it('should compute circular variance correctly', () => {
    function circularVariance(headings: number[]): number {
      let sumSin = 0, sumCos = 0;
      for (const h of headings) {
        const rad = h * Math.PI / 180;
        sumSin += Math.sin(rad);
        sumCos += Math.cos(rad);
      }
      const n = headings.length;
      const meanResultant = Math.sqrt(sumSin * sumSin + sumCos * sumCos) / n;
      return 1 - meanResultant;
    }

    // Perfect alignment -> variance 0
    expect(circularVariance([10, 10, 10])).toBe(0);
    
    // Spread -> variance > 0
    expect(circularVariance([0, 90, 180, 270])).toBe(1);
    
    // Small spread -> small variance
    const alignedVar = circularVariance([10, 11, 10, 10, 11]);
    expect(alignedVar).toBeLessThan(0.001);
  });
});