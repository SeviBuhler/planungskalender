// "Ab in den Wagen": a copy of the product picture flies in an arc to the cart icon and
// shrinks away, then the cart wobbles. Skipped when the system asks for less motion.

const FLIGHT_MS = 800;

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Resolves when the copy has landed (at once if there is nothing to animate)
export async function flyToCart(source: Element | null, cart: Element | null): Promise<void> {
  if (!source || !cart || prefersReducedMotion()) return;
  const from = source.getBoundingClientRect();
  const to = cart.getBoundingClientRect();
  // Hidden (e.g. the tab bar on larger screens) or not in the browser
  if (!to.width || !from.width || typeof source.animate !== 'function') return;

  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.removeAttribute('id');
  ghost.setAttribute('aria-hidden', 'true');
  Object.assign(ghost.style, {
    position: 'fixed', left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`,
    margin: '0', zIndex: '100', pointerEvents: 'none', boxShadow: '0 8px 20px rgb(0 0 0 / 0.25)',
  });
  document.body.append(ghost);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  try {
    // Lifts a little first, then curves into the cart while getting smaller
    await ghost.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.25}px, ${dy * 0.12 - 30}px) scale(1.15)`, opacity: 1, offset: 0.2 },
        { transform: `translate(${dx * 0.8}px, ${dy * 0.75}px) scale(0.6)`, opacity: 1, offset: 0.75 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.08)`, opacity: 0.2 },
      ],
      { duration: FLIGHT_MS, easing: 'cubic-bezier(0.4, 0, 0.6, 1)' }
    ).finished;
  } catch {
    // cancelled, e.g. the page changed
  } finally {
    ghost.remove();
  }
  wobble(cart);
}

export function wobble(el: Element | null) {
  if (!el || prefersReducedMotion() || typeof el.animate !== 'function') return;
  el.animate(
    [{ transform: 'scale(1) rotate(0)' }, { transform: 'scale(1.35) rotate(-12deg)' }, { transform: 'scale(0.9) rotate(6deg)' }, { transform: 'none' }],
    { duration: 420, easing: 'ease-out' }
  );
}
