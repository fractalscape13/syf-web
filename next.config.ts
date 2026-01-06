import type { NextConfig } from "next";

// GitHub Actions configure-pages@v5 automatically injects basePath when static_site_generator: next is set
// The action modifies the next.config file to set basePath directly
// We need to ensure NEXT_PUBLIC_BASE_PATH matches whatever basePath is set
const getBasePath = (): string => {
  // Priority 1: Explicitly set environment variable (set by GitHub Actions workflow)
  if (process.env.NEXT_PUBLIC_BASE_PATH) {
    return process.env.NEXT_PUBLIC_BASE_PATH;
  }
  // Priority 2: Check if we're in a GitHub Actions environment
  if (process.env.GITHUB_REPOSITORY) {
    // Extract repo name from GITHUB_REPOSITORY (format: owner/repo)
    const repoName = process.env.GITHUB_REPOSITORY.split('/')[1];
    if (repoName) {
      return `/${repoName}`;
    }
  }
  // Priority 3: For local production builds, use the known basePath
  if (process.env.NODE_ENV === "production" || process.env.NEXT_PHASE === "phase-production-build") {
    return "/syf-web";
  }
  // Default: empty for local development
  return "";
};

const basePath = getBasePath();

const nextConfig: NextConfig = {
  output: "export",
  // basePath may be injected by GitHub Actions configure-pages@v5
  // If not, we use our default
  basePath: basePath,
  // Don't set assetPrefix when using basePath with static export - basePath handles it
  env: {
    // CRITICAL: Always set NEXT_PUBLIC_BASE_PATH so it's available at runtime in the client
    // This is what the component uses to construct image paths
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
};

export default nextConfig;
