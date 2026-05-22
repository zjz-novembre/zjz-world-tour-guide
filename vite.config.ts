import { defineConfig } from "vite";
import { createRestaurantsApi } from "./server/restaurantsApi";

export default defineConfig({
  base: process.env.MICHELIN_BASE_PATH ?? "/",
  plugins: [
    {
      name: "michelin-restaurants-api",
      configureServer(server) {
        server.middlewares.use(createRestaurantsApi(process.cwd()));
      },
      configurePreviewServer(server) {
        server.middlewares.use(createRestaurantsApi(process.cwd()));
      },
    },
  ],
  esbuild: {
    jsx: "automatic",
  },
});
