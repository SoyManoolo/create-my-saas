import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const target = process.env.API_PROXY_TARGET?.replace(/\/$/, "");
    if (!target) return [];
    return [
      { source: "/auth/:path*", destination: `${target}/auth/:path*` },
      { source: "/users/:path*", destination: `${target}/users/:path*` },
    ];
  },
};

export default nextConfig;
