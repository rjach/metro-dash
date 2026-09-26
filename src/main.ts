import "@fontsource/lilita-one/400.css";
import "@fontsource/nunito/800.css";
import "@fontsource/nunito/900.css";
import "./ui/styles.css";
import { App } from "./app/App";

const supportsWebGL = (): boolean => {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
};

const showFatal = (message: string) => {
  const loading = document.getElementById("loading");
  if (loading) loading.innerHTML = `<div style="max-width:28em;text-align:center;font:800 1.1rem system-ui;padding:2em">${message}</div>`;
};

const boot = async () => {
  const root = document.getElementById("app");
  if (!root) throw new Error("Missing #app root element");
  if (!supportsWebGL()) {
    showFatal("Metro Dash needs WebGL. Please enable hardware acceleration or try a recent version of Chrome, Edge, Firefox or Safari.");
    return;
  }
  // Canvas textures use the display font, so wait for it before painting them.
  await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1500))]);
  await Promise.allSettled([document.fonts.load('400 32px "Lilita One"'), document.fonts.load('800 16px "Nunito"')]);
  const app = new App(root);
  (window as unknown as { __METRO_DASH__: App }).__METRO_DASH__ = app;
  document.getElementById("loading")?.classList.add("hidden");
};

boot().catch((error: unknown) => {
  console.error(error);
  showFatal(`Something went wrong while starting the game: ${error instanceof Error ? error.message : String(error)}`);
});
