/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@bountypad/shared"],
  images: { unoptimized: true },
};
export default nextConfig;
