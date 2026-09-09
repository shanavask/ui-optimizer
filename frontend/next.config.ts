import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "google-auth-library",
  ],
};

export default nextConfig;
