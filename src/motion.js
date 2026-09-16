import { gsap } from 'gsap';

export const MOTION_DEFAULTS = Object.freeze({
  duration: 0.24,
  ease: 'power2.out'
});

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function detectReducedMotion(explicit) {
  if (typeof explicit === 'boolean') return explicit;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function resolveMotionDuration(duration, reducedMotion = false) {
  if (reducedMotion) return 0;
  const numeric = Number(duration);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : MOTION_DEFAULTS.duration;
}

function prepareVars(vars = {}, reducedMotion = false) {
  const next = { ...vars };
  next.duration = resolveMotionDuration(next.duration, reducedMotion);
  if (next.ease === undefined) next.ease = MOTION_DEFAULTS.ease;
  if (reducedMotion) {
    next.delay = 0;
    next.repeat = 0;
    next.yoyo = false;
  }
  return next;
}

/**
 * Shared UI motion boundary. It is intentionally inert until a caller uses
 * from/to/timeline/add, so article content and exported WeChat HTML never
 * depend on animation timing.
 */
export function createMotionLayer(scope = null, options = {}) {
  const root = scope || (typeof document !== 'undefined' ? document : null);
  const reducedMotion = detectReducedMotion(options.prefersReducedMotion);
  const context = root ? gsap.context(() => {}, root) : null;
  const media = gsap.matchMedia();
  let active = true;

  const invoke = factory => {
    if (!active) return null;
    let value;
    const run = () => { value = factory(); };
    if (context) context.add(run);
    else run();
    return value;
  };

  const layer = {
    gsap,
    context,
    matchMedia: media,
    reducedMotion,
    from(target, vars = {}) {
      return invoke(() => gsap.from(target, prepareVars(vars, reducedMotion)));
    },
    to(target, vars = {}) {
      return invoke(() => gsap.to(target, prepareVars(vars, reducedMotion)));
    },
    fromTo(target, fromVars = {}, toVars = {}) {
      return invoke(() => gsap.fromTo(target, prepareVars(fromVars, reducedMotion), prepareVars(toVars, reducedMotion)));
    },
    set(target, vars = {}) {
      return invoke(() => gsap.set(target, vars));
    },
    timeline(vars = {}) {
      return invoke(() => gsap.timeline({ ...vars, paused: vars.paused ?? true }));
    },
    add(conditions, callback) {
      if (!active) return null;
      return media.add(conditions, callback, root || undefined);
    },
    revert() {
      if (!active) return;
      active = false;
      media.revert();
      context?.revert();
    },
    kill() {
      if (!active) return;
      active = false;
      media.revert();
      context?.revert();
    }
  };

  return layer;
}

