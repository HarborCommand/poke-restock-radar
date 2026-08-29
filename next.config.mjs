/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" }
        ]
      },
      {
        source: "/manifest-pos.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }]
      },
      {
        source: "/account/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, no-cache, max-age=0, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" }
        ]
      },
      {
        source: "/app",
        headers: [
          { key: "Cache-Control", value: "private, no-store, no-cache, max-age=0, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" }
        ]
      },
      {
        source: "/dashboard",
        headers: [
          { key: "Cache-Control", value: "private, no-store, no-cache, max-age=0, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" }
        ]
      },
      {
        source: "/login",
        headers: [
          { key: "Cache-Control", value: "private, no-store, no-cache, max-age=0, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" }
        ]
      },
      {
        source: "/pos",
        headers: [
          { key: "Cache-Control", value: "private, no-store, no-cache, max-age=0, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" }
        ]
      },
      {
        source: "/pos/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, no-cache, max-age=0, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" }
        ]
      }
    ];
  }
};

export default nextConfig;
