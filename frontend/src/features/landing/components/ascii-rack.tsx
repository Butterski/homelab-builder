import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { RACK_COLS, RACK_REST_ANGLE, RACK_ROWS, renderRack } from '../lib/ascii-rack';

/** ASCII reads better a little below the screen's frame rate. */
const FRAME_MS = 1000 / 30;
/** Radians a second: once around in about twenty seconds. */
const TURN_SPEED = 0.31;
/** 0 turns at one speed; towards 0.5 it nearly stops at the front and the back. */
const LINGER = 0.32;
/** Radians the rack turns for each pixel it is dragged. */
const DRAG_TURN = 0.012;
/** With reduced motion the lights change this much slower: under three times a second. */
const CALM_LIGHTS = 0.35;

const STILL = renderRack(RACK_REST_ANGLE, 0, RACK_COLS, RACK_ROWS);

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeToMotion(onChange: () => void) {
  const query = window.matchMedia?.(REDUCED_MOTION);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

/** Whether the visitor's system asks for less motion. Follows the setting while the page is open. */
function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeToMotion,
    () => window.matchMedia?.(REDUCED_MOTION).matches ?? false,
    () => false,
  );
}

/**
 * A server rack in 3D, drawn in ASCII. It turns slowly, its status lights
 * blink and its fans spin; it can be paused, and dragged round by hand.
 *
 * A visitor whose system asks for reduced motion gets the rack standing still
 * with its lights on, and can start it with the same button: turning is then
 * something they asked for. (On Windows that setting is "Animation effects",
 * which many people switch off for speed.)
 *
 * What React renders is one still frame, which is also what the prerendered
 * page and a browser without JavaScript show. A loop rewrites the text of the
 * three layers while the rack is on screen.
 */
export function AsciiRack() {
  const root = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLPreElement>(null);
  const ok = useRef<HTMLPreElement>(null);
  const near = useRef<HTMLPreElement>(null);

  const reduced = usePrefersReducedMotion();
  /** What the visitor chose with the button; until then the system setting decides. */
  const [choice, setChoice] = useState<boolean | null>(null);
  const spinning = choice ?? !reduced;

  // The loop below runs for as long as the rack is mounted and reads these.
  const live = useRef({ spinning, reduced });
  useEffect(() => {
    live.current = { spinning, reduced };
  }, [spinning, reduced]);

  useEffect(() => {
    const element = root.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;

    let frame = 0;
    let last = 0;
    let visible = false;
    let dragging = false;
    let dragFrom = 0;
    /** Where the steady turn has got to, what dragging added, and the clock of the lights. */
    let turn = RACK_REST_ANGLE;
    let dragged = 0;
    let lights = 0;

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const elapsed = now - last;
      if (elapsed < FRAME_MS) return;
      // After a pause (a hidden tab, a scroll away) carry on from where it was.
      const seconds = Math.min(elapsed, 100) / 1000;
      last = now;
      if (live.current.spinning && !dragging) turn += seconds * TURN_SPEED;
      lights += seconds * (live.current.reduced ? CALM_LIGHTS : 1);

      const angle = turn - LINGER * Math.sin(2 * turn) + dragged;
      const next = renderRack(angle, lights, RACK_COLS, RACK_ROWS);
      if (shade.current) shade.current.textContent = next.shade;
      if (ok.current) ok.current.textContent = next.ok;
      if (near.current) near.current.textContent = next.near;
    };

    const run = () => {
      cancelAnimationFrame(frame);
      if (visible && !document.hidden) frame = requestAnimationFrame(draw);
    };

    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      run();
    });
    observer.observe(element);

    const onDown = (event: PointerEvent) => {
      dragging = true;
      dragFrom = event.clientX;
      element.setPointerCapture(event.pointerId);
      element.classList.add('is-dragging');
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging) return;
      dragged += (event.clientX - dragFrom) * DRAG_TURN;
      dragFrom = event.clientX;
    };
    const onUp = () => {
      dragging = false;
      element.classList.remove('is-dragging');
    };
    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onUp);
    document.addEventListener('visibilitychange', run);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onUp);
      document.removeEventListener('visibilitychange', run);
    };
  }, []);

  return (
    <figure className="lp-rack-figure">
      <div
        ref={root}
        className="lp-rack"
        role="img"
        aria-label="A server rack drawn in ASCII characters: a patch panel, a switch, two servers, a disk shelf and a UPS, with blinking status lights."
      >
        <pre ref={shade} aria-hidden="true">
          {STILL.shade}
        </pre>
        <pre ref={ok} className="is-ok" aria-hidden="true">
          {STILL.ok}
        </pre>
        <pre ref={near} className="is-near" aria-hidden="true">
          {STILL.near}
        </pre>
      </div>
      <figcaption>
        <button type="button" onClick={() => setChoice(!spinning)}>
          {spinning ? 'Pause' : 'Spin it'}
        </button>
        <span>or drag it round</span>
      </figcaption>
    </figure>
  );
}
