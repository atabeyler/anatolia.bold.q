import { describe, expect, it } from 'vitest';
import { buildAdjacency, graphFeatureVector, knownLabelMap } from './ellipticGraph.js';

describe('ellipticGraph', () => {
  it('builds directed and undirected adjacency from edges', () => {
    const { out, inn, undirected } = buildAdjacency([['a', 'b'], ['a', 'c']]);
    expect(out.get('a')).toEqual(new Set(['b', 'c']));
    expect(inn.get('b')).toEqual(new Set(['a']));
    expect(undirected.get('b')).toEqual(new Set(['a']));
    expect(undirected.get('a')).toEqual(new Set(['b', 'c']));
  });

  it('keeps only known labels in a part', () => {
    const part = { samples: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], labels: new Map([['a', 'illicit'], ['b', 'licit']]) };
    const map = knownLabelMap(part);
    expect(map.get('a')).toBe(1);
    expect(map.get('b')).toBe(0);
    expect(map.has('c')).toBe(false);
  });

  it('computes degree and train-only 1-hop/2-hop illicit ratios', () => {
    // a -- b(illicit,train) -- d(unlabeled)
    // a -- c(licit,train)
    const adjacency = buildAdjacency([['a', 'b'], ['a', 'c'], ['b', 'd']]);
    const trainLabelMap = new Map([['b', 1], ['c', 0]]);
    const [inDeg, outDeg, degree, oneHopCount, oneHopKnown, oneHopIllicit, oneHopRatio, twoHopCount, twoHopKnown, twoHopRatio] =
      graphFeatureVector('a', adjacency, trainLabelMap);
    expect(inDeg).toBe(0);
    expect(outDeg).toBe(2);
    expect(degree).toBe(2);
    expect(oneHopCount).toBe(2);
    expect(oneHopKnown).toBe(2);
    expect(oneHopIllicit).toBe(1);
    expect(oneHopRatio).toBe(0.5);
    expect(twoHopCount).toBe(1); // d, reached via b
    expect(twoHopKnown).toBe(0); // d has no train label
    expect(twoHopRatio).toBe(0);
  });

  it('never lets a non-train label leak into the neighbor ratio', () => {
    // e's only neighbor f is labeled illicit, but only in validation -- so
    // trainLabelMap (built from knownLabelMap(trainPart)) must not contain it.
    const adjacency = buildAdjacency([['e', 'f']]);
    const trainPart = { samples: [{ id: 'e' }], labels: new Map() }; // f never appears in train
    const trainLabelMap = knownLabelMap(trainPart);
    const [, , , , oneHopKnown, oneHopIllicit, oneHopRatio] = graphFeatureVector('e', adjacency, trainLabelMap);
    expect(oneHopKnown).toBe(0);
    expect(oneHopIllicit).toBe(0);
    expect(oneHopRatio).toBe(0);
  });

  it('returns zeroed stats for a node absent from the edge list', () => {
    const adjacency = buildAdjacency([['a', 'b']]);
    const vector = graphFeatureVector('isolated', adjacency, new Map());
    expect(vector).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
