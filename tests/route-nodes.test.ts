import { describe, it, expect } from 'vitest';
import { calculateRouteNodes } from '../src/router/routeNodes.js';
import { fastDistance } from '../src/utils/math.js';

describe('calculateRouteNodes', () => {
  it('should return empty array for no coords', () => {
    const nodes = calculateRouteNodes(10000, [], 5000);
    expect(nodes).toEqual([]);
  });

  it('should create nodes at interval distance', () => {
    // 10km straight line east
    const coords = [
      { lat: 14.0, lng: 120.0 },
      { lat: 14.0, lng: 120.09 } // ~10km at equator
    ];
    const nodes = calculateRouteNodes(10000, coords, 5000);
    expect(nodes.length).toBe(2); // 2 nodes at 5km and 10km
    expect(nodes[0].id).toBe(1);
    expect(nodes[1].id).toBe(2);
  });

  it('should interpolate between coordinates', () => {
    // 20km line with 3 segments
    const coords = [
      { lat: 14.0, lng: 120.0 },
      { lat: 14.0, lng: 120.045 }, // ~5km
      { lat: 14.0, lng: 120.09 }   // ~5km more
    ];
    const nodes = calculateRouteNodes(10000, coords, 5000);
    // Should have nodes at 5km and 10km
    expect(nodes.length).toBe(2);
  });

  it('should mark all nodes as not passed initially', () => {
    const coords = [
      { lat: 14.0, lng: 120.0 },
      { lat: 14.0, lng: 120.09 }
    ];
    const nodes = calculateRouteNodes(10000, coords, 5000);
    expect(nodes.every(n => n.passed === false)).toBe(true);
  });
});

describe('fastDistance', () => {
  it('should calculate Manila to Quezon City distance', () => {
    const dist = fastDistance(14.5995, 120.9842, 14.6760, 121.0437);
    expect(dist).toBeGreaterThan(8000);
    expect(dist).toBeLessThan(12000);
  });

  it('should return 0 for same coordinates', () => {
    const dist = fastDistance(14.5995, 120.9842, 14.5995, 120.9842);
    expect(dist).toBe(0);
  });

  it('should be symmetric', () => {
    const d1 = fastDistance(14.0, 120.0, 14.5, 121.0);
    const d2 = fastDistance(14.5, 121.0, 14.0, 120.0);
    expect(d1).toBeCloseTo(d2, 5);
  });
});