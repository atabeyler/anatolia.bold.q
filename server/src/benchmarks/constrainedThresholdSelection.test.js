import test from 'node:test';
import assert from 'node:assert/strict';
import { selectConstrainedThreshold } from './constrainedThresholdSelection.js';

const labels = ['illicit', 'illicit', 'licit', 'licit', 'licit'];
const scores = [0.91, 0.61, 0.70, 0.40, 0.10];

test('keeps zero false negatives when minRecall is 1', () => {
  const selected = selectConstrainedThreshold(labels, scores, { minRecall: 1, orientations: [1] });
  assert.equal(selected.metrics.fn, 0);
  assert.equal(selected.metrics.recall, 1);
  assert.equal(selected.threshold, 0.61);
  assert.equal(selected.metrics.fp, 1);
});

test('raises threshold only when recall constraint permits it', () => {
  const selected = selectConstrainedThreshold(labels, scores, { minRecall: 0.5, orientations: [1] });
  assert.equal(selected.threshold, 0.91);
  assert.equal(selected.metrics.precision, 1);
  assert.equal(selected.metrics.recall, 0.5);
});

test('supports inverted orientation with numeric convention', () => {
  const invertedScores = scores.map((score) => 1 - score);
  const selected = selectConstrainedThreshold(labels, invertedScores, { minRecall: 1, orientations: [-1] });
  assert.equal(selected.orientation, -1);
  assert.equal(selected.metrics.fn, 0);
  assert.equal(selected.threshold, 0.61);
});
