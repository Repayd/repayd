import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  images: { unoptimized: true },
  async rewrites() {
    return { beforeFiles: [{ source: "/", destination: "/legacy-landing.html" }] };
  },
};

export default nextConfig;
