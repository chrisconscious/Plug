
import type { Plugin, HtmlTagDescriptor } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

/**
 * Generic HTML-shell chrome injection.
 *
 * - Wires Alpine.js from the CDN into <head> ONLY when VITE_ENABLE_ALPINE=true.
 *   The React app never uses it; loading it unconditionally cost every visitor
 *   an extra third-party request (a floating "3.x.x" version) and triggered
 *   browser "Tracking Prevention blocked access to storage" console warnings.
 *   Enable it only if VITE_SITE_CHROME_* markup relies on x-data directives.
 * - VITE_SITE_CHROME_HEADER / VITE_SITE_CHROME_FOOTER carry raw markup that is
 *   injected into <body> top/bottom VERBATIM (never escaped) so an operator can
 *   drop in site chrome (top bar, live-chat widget, analytics tags) without
 *   touching React source. When unset the sections are simply absent.
 */
const ALPINE_CDN = "https://cdn.jsdelivr.net/npm/alpinejs@3.14.9/dist/cdn.min.js";

function siteChromeInjection(): Plugin {
  const headerHtml = process.env.VITE_SITE_CHROME_HEADER || "";
  const footerHtml = process.env.VITE_SITE_CHROME_FOOTER || "";
  return {
    name: "fashioned-site-chrome-injection",
    transformIndexHtml(html) {
      const tags: HtmlTagDescriptor[] = [];
      if (process.env.VITE_ENABLE_ALPINE === "true" && !html.includes("alpinejs")) {
        tags.push({ tag: "script", attrs: { src: ALPINE_CDN, defer: "true" }, injectTo: "head" });
      }
      if (headerHtml) {
        tags.push({ tag: "div", attrs: { id: "site-chrome-header", "data-chrome": "header" }, children: headerHtml, injectTo: "body-prepend" });
      }
      if (footerHtml) {
        tags.push({ tag: "div", attrs: { id: "site-chrome-footer", "data-chrome": "footer" }, children: footerHtml, injectTo: "body" });
      }
      return { html, tags };
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(() => ({
  base: process.env.VITE_BASE || "/",
  plugins: [react(), siteChromeInjection()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
   port: 5173,
   strictPort: true,
   // Serve the API-generated web manifest from the SAME origin as the
   // document. Browsers ignore manifest start_url/scope when the manifest
   // URL is cross-origin to the page, so gate /api/v1/manifest through the
   // dev server instead of linking straight to VITE_API_BASE_URL. Data/API
   // calls keep using the absolute backend URL; only the manifest uses this.
   proxy: {
     '/api/v1/manifest': {
       target: process.env.VITE_API_BASE_URL || 'http://localhost:3001',
       changeOrigin: true,
     },
   },
  },
}));