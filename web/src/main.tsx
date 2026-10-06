import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { DiffWorkers } from "./lib/diff-workers";
import { applyTheme, watchSystemTheme } from "./lib/theme";
import { applyCodePrefs } from "./lib/code-prefs";

applyTheme();
applyCodePrefs();
watchSystemTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DiffWorkers>
      <App />
    </DiffWorkers>
  </StrictMode>,
);
