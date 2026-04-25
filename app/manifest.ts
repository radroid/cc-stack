import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Create Club Stack",
    short_name: "CC Stack",
    description: "A PWA-ready Next.js + Convex + Clerk starter.",
    start_url: "/",
    display: "standalone",
    theme_color: "#0a0a0a",
    background_color: "#ffffff",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
