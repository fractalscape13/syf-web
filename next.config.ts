import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  output: "export",
  basePath: isProd ? "/syf-web" : "",
  assetPrefix: isProd ? "/syf-web/" : "",
  env: {
    NEXT_PUBLIC_BASE_PATH: isProd ? "/syf-web" : "",
  },
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
};

export default nextConfig;
