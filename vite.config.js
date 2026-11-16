import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { legalPagesPlugin } from "./legal-pages.js";

export default defineConfig({
  // legalPagesPlugin: public no-login pages for src/legalDocs.js at
  // /more/legal/<slug> (e.g. the privacy policy URL used on Google Play).
  plugins: [react(), legalPagesPlugin()],
});
