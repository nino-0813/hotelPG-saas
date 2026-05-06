import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node-ical → temporal polyfill → jsbi: bundling breaks JSBI.BigInt on server
  serverExternalPackages: ["node-ical", "@js-temporal/polyfill", "jsbi"],
};

export default nextConfig;
