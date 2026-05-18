import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Pull only used date-fns modules instead of the full package in client bundles
    optimizePackageImports: ["date-fns"],
  },
};

export default nextConfig;
