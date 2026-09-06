import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Uploaded documents are read back through app/api/download, never served
  // statically, so there is no image loader or public asset path to configure.
  experimental: {
    // Document uploads go through a Server Action-free route handler, but the
    // onboarding forms post multi-megabyte photographs. The default 1 MB body
    // limit rejects them with an opaque error.
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
