/** @type {import('next').NextConfig} */
const isStatic = process.env.STATIC_EXPORT === "true";

const nextConfig = {
  reactStrictMode: true,
  ...(isStatic && {
    output: "export",
    images: { unoptimized: true },
    trailingSlash: true,
  }),
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "@react-native-async-storage/async-storage": false,
      "pino-pretty": false,
    };
    return config;
  },
};

module.exports = nextConfig;
