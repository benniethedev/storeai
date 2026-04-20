/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@storeai/auth",
    "@storeai/db",
    "@storeai/queue",
    "@storeai/storage",
    "@storeai/shared",
  ],
  experimental: {
    externalDir: true,
  },
  serverExternalPackages: ["argon2", "postgres", "bullmq", "ioredis"],
  webpack: (config, { isServer }) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    if (isServer) {
      // Keep native / Node-only packages external so webpack doesn't bundle
      // their prebuilt .node binaries.
      const externals = config.externals || [];
      const list = ["argon2", "postgres", "bullmq", "ioredis"];
      config.externals = [
        ...externals,
        ({ request }, cb) => {
          if (request && list.some((n) => request === n || request.startsWith(`${n}/`))) {
            return cb(null, `commonjs ${request}`);
          }
          cb();
        },
      ];
    }
    return config;
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
