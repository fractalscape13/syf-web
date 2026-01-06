import type { NextConfig } from "next";

// For GitHub Pages, always use basePath when building (not in dev)
// Check if we're building (not just NODE_ENV, since that might not be set)
const isProd = process.env.NODE_ENV === "production" || process.env.NEXT_PHASE === "phase-production-build";
const basePath = isProd ? "/syf-web" : "";

const nextConfig: NextConfig = {
  output: "export",
  basePath: basePath,
  // Don't set assetPrefix when using basePath with static export - basePath handles it
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
};

export default nextConfig;
