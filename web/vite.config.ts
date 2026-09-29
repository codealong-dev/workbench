import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const phoenix = `http://127.0.0.1:${process.env.PORT ?? 4000}`;

// In dev, inject the socket token the same way Phoenix does in prod. Read on
// every request so it works whichever of Phoenix/Vite started first.
function devToken(): Plugin {
  return {
    name: "workbench-dev-token",
    apply: "serve",
    transformIndexHtml(html) {
      const home = process.env.WB_HOME ?? join(homedir(), ".workbench");
      let token = process.env.WB_TOKEN ?? "";
      try {
        token ||= readFileSync(join(home, "token"), "utf8").trim();
      } catch {
        // Phoenix hasn't created it yet; reload once it has.
      }
      return html.replace("</head>", `<meta name="wb-token" content="${token}"></head>`);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devToken()],
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/socket": { target: phoenix, ws: true },
      "/api": phoenix,
    },
  },
  build: {
    outDir: "../server/priv/static",
    emptyOutDir: true,
  },
});
