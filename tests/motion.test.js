import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionLayer, MOTION_DEFAULTS, resolveMotionDuration } from '../src/motion.js';

test('motion layer keeps a shared default and honors reduced motion', () => {
  assert.equal(MOTION_DEFAULTS.duration, 0.24);
  assert.equal(resolveMotionDuration(undefined), 0.24);
  assert.equal(resolveMotionDuration(undefined, true), 0);
  assert.equal(resolveMotionDuration(0.5, true), 0);

  const layer = createMotionLayer(null, { prefersReducedMotion: true });
  assert.equal(layer.reducedMotion, true);
  assert.equal(typeof layer.from, 'function');
  assert.equal(typeof layer.to, 'function');
  assert.equal(typeof layer.timeline, 'function');
  assert.equal(typeof layer.add, 'function');
  layer.revert();
  assert.equal(layer.from({}, {}), null);
});

