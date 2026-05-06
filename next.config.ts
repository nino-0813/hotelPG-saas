import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node-ical → temporal polyfill → jsbi: bundling breaks JSBI.BigInt on server
  serverExternalPackages: ["node-ical", "@js-temporal/polyfill", "jsbi"],
  experimental: {
    // Pull only used date-fns modules instead of the full package in client bundles
    optimizePackageImports: ["date-fns"],
  },
};

export default nextConfig;
