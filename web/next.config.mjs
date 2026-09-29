/**
 * The website and the API are served from ONE origin: the browser only talks to the site, and
 * /api/* is proxied to the API service. That keeps the "Log in with X" session cookie first-party
 * everywhere (hosting domains like *.onrender.com are separate sites for cookies).
 *   API_PROXY_TARGET  where the API runs (Render: its private host:port). Default: local API.
 */
const target = (() => {
  const t = process.env.API_PROXY_TARGET || "http://127.0.0.1:4000";
  return /^https?:\/\//.test(t) ? t.replace(/\/$/, "") : `http://${t}`;
})();

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@bountypad/shared"],
  images: { unoptimized: true },
  // Streams (live events) must not be compressed/buffered by the proxy.
  compress: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${target}/api/:path*` }];
  },
  webpack: (config) => {
    // Optional Privy integration we don't use (Farcaster mini apps).
    config.resolve.alias = { ...config.resolve.alias, "@farcaster/mini-app-solana": false };
    return config;
  },
};
export default nextConfig;
