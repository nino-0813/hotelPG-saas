import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node-ical@0.26 → temporal-polyfill + rrule-temporal (must be installed + external on Vercel)
  serverExternalPackages: ["node-ical", "temporal-polyfill", "rrule-temporal"],
  experimental: {
    // Pull only used date-fns modules instead of the full package in client bundles
    optimizePackageImports: ["date-fns"],
  },
};

export default nextConfig;
