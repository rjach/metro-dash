/** Original inline SVG icon set (no third-party artwork). */
const svg = (body: string, viewBox = "0 0 24 24") =>
  `<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  coin: svg(
    `<circle cx="12" cy="12" r="10.5" fill="#d98c00"/><circle cx="12" cy="11.2" r="9.6" fill="#ffcc1f"/><circle cx="12" cy="11.2" r="7" fill="none" stroke="#e39a00" stroke-width="1.6"/><path d="M8.2 15V8.2l3.8 4 3.8-4V15" fill="none" stroke="#b36b00" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"/><ellipse cx="8.5" cy="6.6" rx="2.6" ry="1.3" fill="#fff6b0" opacity=".8"/>`,
  ),
  key: svg(
    `<circle cx="8" cy="9" r="5.2" fill="#1b9ad6"/><circle cx="8" cy="9" r="4.2" fill="#39c5ff"/><circle cx="8" cy="9" r="1.8" fill="#0b3f8c"/><path d="M11.8 11.5l8.5 7.2-1.8 2-1.6-1.3-1.3 1.5-1.6-1.3 1.3-1.5-5-4.2z" fill="#39c5ff" stroke="#1b9ad6" stroke-width="1"/>`,
  ),
  pause: svg(`<rect x="5.5" y="4" width="4.6" height="16" rx="1.3" fill="#fff"/><rect x="13.9" y="4" width="4.6" height="16" rx="1.3" fill="#fff"/>`),
  play: svg(`<path d="M7 4.5v15l12.5-7.5z" fill="#fff" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>`),
  home: svg(
    `<path d="M3 11.5L12 4l9 7.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10.5V20h4.5v-5.5h3V20H18v-9.5" fill="#fff"/>`,
  ),
  gear: svg(
    `<path fill="#fff" d="M10.3 2h3.4l.5 2.6 1.7.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.7 2.6.5v3.4l-2.6.5-.8 1.7 1.5 2.2-2.4 2.4-2.2-1.5-1.7.8-.5 2.6h-3.4l-.5-2.6-1.7-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.7L2 13.7v-3.4l2.6-.5.8-1.7L3.9 5.9l2.4-2.4 2.2 1.5 1.7-.8z"/><circle cx="12" cy="12" r="3.6" fill="#1f74dc"/>`,
  ),
  person: svg(`<circle cx="12" cy="7" r="4.2" fill="#fff"/><path d="M4 21c0-4.8 3.6-8 8-8s8 3.2 8 8z" fill="#fff"/>`),
  board: svg(
    `<rect x="2" y="9" width="20" height="6" rx="3" fill="#fff"/><rect x="5" y="10.6" width="3" height="2.8" rx="1" fill="#ffd23f"/><rect x="10.5" y="10.6" width="3" height="2.8" rx="1" fill="#ffd23f"/><rect x="16" y="10.6" width="3" height="2.8" rx="1" fill="#ffd23f"/><ellipse cx="12" cy="18.5" rx="7" ry="1.6" fill="#7cf6ff" opacity=".9"/>`,
  ),
  shop: svg(
    `<path d="M5 8h14l-1.2 12.5H6.2z" fill="#fff"/><path d="M8.5 8V6.5a3.5 3.5 0 017 0V8" fill="none" stroke="#fff" stroke-width="2.2"/><circle cx="12" cy="14" r="2.4" fill="#ffcc1f"/>`,
  ),
  trophy: svg(
    `<path d="M7 3h10v5a5 5 0 01-10 0z" fill="#ffd23f"/><path d="M7 5H3.5v1.5A3.5 3.5 0 007 10M17 5h3.5v1.5A3.5 3.5 0 0117 10" fill="none" stroke="#ffd23f" stroke-width="1.8"/><rect x="10.5" y="12.5" width="3" height="4" fill="#ffd23f"/><rect x="7" y="16.5" width="10" height="3.5" rx="1" fill="#ffd23f"/>`,
  ),
  camera: svg(
    `<path d="M3 7.5h3.2L8 5h8l1.8 2.5H21V19H3z" fill="#fff" stroke="#fff" stroke-width="1" stroke-linejoin="round"/><circle cx="12" cy="13" r="4" fill="#1f74dc"/><circle cx="12" cy="13" r="2.2" fill="#9fd8ff"/>`,
  ),
  keyboard: svg(
    `<rect x="2" y="6" width="20" height="12" rx="2.2" fill="#fff"/><g fill="#1f74dc"><rect x="4.5" y="8.5" width="2.4" height="2.2" rx=".5"/><rect x="8.2" y="8.5" width="2.4" height="2.2" rx=".5"/><rect x="11.9" y="8.5" width="2.4" height="2.2" rx=".5"/><rect x="15.6" y="8.5" width="2.4" height="2.2" rx=".5"/><rect x="6.3" y="12.2" width="2.4" height="2.2" rx=".5"/><rect x="10" y="12.2" width="2.4" height="2.2" rx=".5"/><rect x="13.7" y="12.2" width="2.4" height="2.2" rx=".5"/><rect x="7" y="15.3" width="10" height="1.6" rx=".5"/></g>`,
  ),
  arrowLeft: svg(`<path d="M15.5 4L7 12l8.5 8" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`),
  arrowRight: svg(`<path d="M8.5 4l8.5 8-8.5 8" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`),
  arrowUp: svg(`<path d="M4 15.5L12 7l8 8.5" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`),
  arrowDown: svg(`<path d="M4 8.5l8 8.5 8-8.5" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`),
  back: svg(
    `<path d="M10 5L3.5 12l6.5 7" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 12h9.5a6.5 6.5 0 010 13" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" transform="translate(0 -6)"/>`,
  ),
  close: svg(`<path d="M5.5 5.5l13 13M18.5 5.5l-13 13" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>`),
  check: svg(`<path d="M4.5 12.5l5 5L19.5 7" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`),
  lock: svg(
    `<rect x="5" y="10.5" width="14" height="10" rx="2" fill="#0b2a5b"/><path d="M8 10.5V8a4 4 0 018 0v2.5" fill="none" stroke="#0b2a5b" stroke-width="2.4"/>`,
  ),
  sound: svg(
    `<path d="M3.5 9h4L13 4.5v15L7.5 15h-4z" fill="#fff"/><path d="M16.5 8.5a5 5 0 010 7M18.8 6a8.5 8.5 0 010 12" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`,
  ),
  mute: svg(
    `<path d="M3.5 9h4L13 4.5v15L7.5 15h-4z" fill="#fff"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>`,
  ),
  shield: svg(
    `<path d="M12 2.5l8 3v6c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10v-6z" fill="#fff"/><path d="M8.5 12l2.5 2.5 4.5-5" fill="none" stroke="#2bd46b" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  magnet: svg(
    `<path d="M5 3.5h4.5v8a2.5 2.5 0 005 0v-8H19v8a7 7 0 01-14 0z" fill="#e6392f" stroke="#fff" stroke-width="1.2"/><rect x="5" y="3.5" width="4.5" height="3.5" fill="#e9eef2"/><rect x="14.5" y="3.5" width="4.5" height="3.5" fill="#e9eef2"/>`,
  ),
  jetpack: svg(
    `<rect x="5" y="4" width="5.5" height="12" rx="2.75" fill="#ffb300" stroke="#fff" stroke-width="1"/><rect x="13.5" y="4" width="5.5" height="12" rx="2.75" fill="#ffb300" stroke="#fff" stroke-width="1"/><path d="M6.2 16.5l1.6 5 1.6-5M14.7 16.5l1.6 5 1.6-5" fill="#ff5a1f"/>`,
  ),
  sneakers: svg(
    `<path d="M2.5 16.5V11l5-1 2.5 2.5 5 1.5 6 1.2v2.3z" fill="#2bd46b" stroke="#fff" stroke-width="1.1" stroke-linejoin="round"/><rect x="2.5" y="16.5" width="19" height="2.5" rx="1" fill="#fff"/><path d="M3 9l3-5 1.5 4" fill="#fff"/>`,
  ),
  multiplier: svg(
    `<circle cx="12" cy="12" r="10" fill="#2f7de1" stroke="#fff" stroke-width="1.4"/><text x="12" y="16.3" text-anchor="middle" font-family="Lilita One, Arial Black, sans-serif" font-size="11.5" fill="#fff">2x</text>`,
  ),
  mystery: svg(
    `<rect x="3.5" y="3.5" width="17" height="17" rx="2.5" fill="#8e3bd6" stroke="#ffd23f" stroke-width="1.8"/><text x="12" y="17" text-anchor="middle" font-family="Lilita One, Arial Black, sans-serif" font-size="13" fill="#ffd23f">?</text>`,
  ),
  jump: svg(
    `<path d="M12 3v13M6 8.5L12 3l6 5.5" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><rect x="5" y="18.5" width="14" height="2.5" rx="1.2" fill="#fff"/>`,
  ),
  crouch: svg(
    `<path d="M12 3v13M6 10.5l6 5.5 6-5.5" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><rect x="5" y="18.5" width="14" height="2.5" rx="1.2" fill="#fff"/>`,
  ),
  eye: svg(
    `<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" fill="none" stroke="#fff" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="#fff"/>`,
  ),
  refresh: svg(
    `<path d="M19.5 12a7.5 7.5 0 11-2.2-5.3" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round"/><path d="M20 3.5v5h-5" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  rocket: svg(
    `<path d="M12 2.5c3.2 2.2 4.8 5.6 4.5 10l-2 3.5h-5l-2-3.5c-.3-4.4 1.3-7.8 4.5-10z" fill="#fff"/><circle cx="12" cy="9" r="1.9" fill="#1f74dc"/><path d="M7.5 12.5L4.5 16l3.5.5M16.5 12.5l3 3.5-3.5.5" fill="#ff5a1f"/><path d="M10 17l2 4.5 2-4.5" fill="#ffb300"/>`,
  ),
  hands: svg(`<path d="M6 21v-7l-2-7 2-.5 2 5V4h2v7h1V3h2v8h1V4.5h2V13l1.5-3 1.8.8L17 18v3z" fill="#fff"/>`),
} as const;

export type IconName = keyof typeof ICONS;

export const icon = (name: IconName): string => ICONS[name];
