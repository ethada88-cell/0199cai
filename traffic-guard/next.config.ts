import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ip2region-ts"],
  async headers() {
    return [
      {
        source: "/guard.js",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
      {
        source: "/guard-run.js",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
      {
        source: "/track.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=300" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
      {
        source: "/collect",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
