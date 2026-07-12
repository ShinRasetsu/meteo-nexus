import { describe, it, expect } from 'vitest';
import { calculateRouteNodes } from '../src/router/routeNodes.js';
import { fastDistance } from '../src/utils/math.js';

describe('Route Nodes Calculation', () => {
  const testCoords = [
    { lat: 14.5995, lng: 120.9842 }, // Manila
    { lat: 14.6091, lng: 120.9840 }, // 1km north
    { lat: 14.6187, lng: 120.9838 }, // 2km north
    { lat: 14.6283, lng: 120.9836 }, // 3km north
    { lat: 14.6379, lng: 120.9834 }  // 4km north
  ];

  it('should generate correct number of nodes', () => {
    const totalDist = 4000; // 4km
    const interval = 1000; // 1km
    const nodes = calculateRouteNodes(totalDist, testCoords, interval);
    expect(nodes.length).toBe(4); // 4km / 1km = 4 nodes
  });

  it('should interpolate nodes correctly along the path', () => {
    const totalDist = 4000;
    const interval = 2000;
    const nodes = calculateRouteNodes(totalDist, testCoords, interval);
    expect(nodes.length).toBe(2);
    // Node 1 should be at ~2km
    expect(nodes[0].lat).toBeCloseTo(14.6187, 3);
    expect(nodes[0].lon).toBeCloseTo(120.9838, 3);
  });

  it('should return empty array for empty coords', () => {
    const nodes = calculateRouteNodes(1000, [], 1000);
    expect(nodes).toEqual([]);
  });

  it('should handle zero interval', () => {
    const nodes = calculateRouteNodes(1000, testCoords, 0);
    expect(nodes.length).toBe(0);
  });
});

describe('fastDistance', () => {
  it('should calculate distance correctly', () => {
    // Manila to Quezon City ~10km
    const dist = fastDistance(14.5995, 120.9842, 14.6760, 121.0437);
    expect(dist).toBeGreaterThan(9000);
    expect(dist).toBeLessThan(11000);
  });

  it('should return 0 for same coordinates', () => {
    const dist = fastDistance(14.5995, 120.9842, 14.5995, 120.9842);
    expect(dist).toBe(0);
  });
});