import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep recently visited CRM routes mounted so navigating back restores the
  // user's loaded data, filters, scroll position, and in-progress work.
  cacheComponents: true,
};

export default nextConfig;
