import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@google-cloud/firestore",
    "@google-cloud/tasks",
    "google-auth-library",
    "google-gax",
  ],
};

export default nextConfig;
