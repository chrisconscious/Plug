
import type { Plugin, HtmlTagDescriptor } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

/**
 * Injects the canvas postMessage bridge into every dev + production index.html so the
 * parent app can install the vh-fix script cross-origin (see frontend IframeNavigation).
 * Without this, `vite build` drops the hand-written inline script from source index.html
 * in some pipelines — the transform runs for all HTML outputs.
 */
function uxpilotCanvasVhBridge(): Plugin {
  return {
    name: "uxpilot-canvas-vh-bridge",
    transformIndexHtml(html) {
      if (html.includes("__UXP_VH_FIX_BRIDGE__")) return html;
      const bridge =
        "<script>" +
        "(function(){\n" +
        "if (window.__UXP_VH_FIX_BRIDGE__) return;\n" +
        "window.__UXP_VH_FIX_BRIDGE__ = true;\n" +
        "window.addEventListener('message', function(e) {\n" +
        "var d = e.data;\n" +
        "if (!d || d.type !== 'uxpilot:install-vh-fix' || typeof d.payload !== 'string') return;\n" +
        "if (window.__uxpVhFixInjected) return;\n" +
        "window.__uxpVhFixInjected = true;\n" +
        "var s = document.createElement('script');\n" +
        "s.setAttribute('data-uxp', 'vh-fix');\n" +
        "s.textContent = d.payload;\n" +
        "(document.head || document.documentElement).appendChild(s);\n" +
        "});\n" +
        "})();" +
        "</script>";
      return html.replace(/<head([^>]*)>/i, "<head$1>\n" + bridge + "\n");
    },
  };
}

/**
 * Generic HTML-shell chrome injection.
 *
 * - Always wires Alpine.js from the CDN into <head> (global scripting layer).
 * - VITE_SITE_CHROME_HEADER / VITE_SITE_CHROME_FOOTER carry raw markup that is
 *   injected into <body> top/bottom VERBATIM (never escaped) so an operator can
 *   drop in site chrome (top bar, live-chat widget, analytics tags) without
 *   touching React source. When unset the sections are simply absent.
 */
const ALPINE_CDN = "https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js";

function siteChromeInjection(): Plugin {
  const headerHtml = process.env.VITE_SITE_CHROME_HEADER || "";
  const footerHtml = process.env.VITE_SITE_CHROME_FOOTER || "";
  return {
    name: "fashioned-site-chrome-injection",
    transformIndexHtml(html) {
      const tags: HtmlTagDescriptor[] = [];
      if (!html.includes("alpinejs")) {
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
  plugins: [react(), uxpilotCanvasVhBridge(), siteChromeInjection()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
   port: 5173,
   strictPort: true,
   hmr: {
     protocol: 'ws',
     host: 'localhost',
     port: 5173,
   },
   allowedHosts: ['uxpilot.net','host.uxpilot.net','dev.host.uxpilot.net', 'uxpilot.ai', 'localhost', '127.0.0.1'],
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