/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@bountypad/shared"],
  images: { unoptimized: true },
  webpack: (config) => {
    // Optional Privy integration we don't use (Farcaster mini apps).
    config.resolve.alias = { ...config.resolve.alias, "@farcaster/mini-app-solana": false };
    return config;
  },
};
export default nextConfig;
