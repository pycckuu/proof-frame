/** @type {import('next').NextConfig} */
const isStatic = process.env.STATIC_EXPORT === "true";

const nextConfig = {
  reactStrictMode: true,
  ...(isStatic && {
    output: "export",
    images: { unoptimized: true },
    trailingSlash: true,
  }),
};

module.exports = nextConfig;
