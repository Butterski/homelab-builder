import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Starts the motion of one block the first time it is seen, and reports whether
 * it is on screen now.
 *
 * The block is complete without any of this: with reduced motion, without
 * JavaScript, and in the copy of the page written at build time, it simply
 * shows its final state. When motion is welcome, the block gets `is-armed`
 * (landing.css holds it at its starting state) and then `is-live` once enough
 * of it has scrolled into view.
 */
export function useLive(ref: RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    if (!window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches) return;

    element.classList.add('is-armed');
    const observer = new IntersectionObserver(
      entries => {
        const seen = entries.some(entry => entry.isIntersecting);
        if (seen) element.classList.add('is-live');
        setVisible(seen);
      },
      { threshold: 0.3 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return visible;
}
