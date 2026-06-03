// Tiny DOM helpers. Tagged template literal builds an element from HTML.
// Safer than innerHTML for unknown content (we use it on values we trust —
// strings from our own API — but escape user-visible text just in case).

export function h(html: string): HTMLElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild as HTMLElement;
}

/** HTML-escape a string for safe inclusion in template literals. */
export function esc(value: unknown): string {
  const s = String(value ?? '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function $(selector: string, root: ParentNode = document): HTMLElement | null {
  return root.querySelector(selector);
}

export function $$<T extends HTMLElement = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T[] {
  return Array.from(root.querySelectorAll(selector)) as T[];
}
