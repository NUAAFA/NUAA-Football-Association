import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    // Mutable managed media must pass its authorization route on every read.
    // Parameter validation rejects old optimizer URLs before cache lookup.
    localPatterns: ["/images/**", "/brand/**", "/compliance/**", "/documents/**", "/_next/static/media/**"].map((pathname) => ({ pathname, search: "" })),
  },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ] }];
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
