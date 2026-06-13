import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" → GitHub Pages 하위 경로, Netlify, Vercel 어디서든 동작
export default defineConfig({
  plugins: [react()],
  base: "./",
});
