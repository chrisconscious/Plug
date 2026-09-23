/** @type {import('next').NextConfig} */
const nextConfig = {
  // API-only backend: this project is intentionally not serving customer-facing pages.
  reactStrictMode: true,
  poweredByHeader: false, // don't leak "X-Powered-By: Next.js"
  eslint: { ignoreDuringBuilds: false },
};
export default nextConfig;
