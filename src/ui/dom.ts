type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>;

/**
 * Tiny hyperscript helper. Attributes starting with "on" become event
 * listeners; `html` sets trusted inline markup (only used for bundled SVG icons).
 */
export const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "html") {
      element.innerHTML = String(value);
    } else if (key === "class") {
      element.className = String(value);
    } else if (value === true) {
      element.setAttribute(key, "");
    } else {
      element.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
};

export const clear = (element: Element) => {
  while (element.firstChild) element.removeChild(element.firstChild);
};

export const formatNumber = (value: number): string => Math.floor(value).toLocaleString("en-US");

export const padScore = (value: number): string => String(Math.floor(value)).padStart(6, "0");
