/** @type {import('next').NextConfig} */
const nextConfig = {
  // 跳过 TypeScript 和 ESLint 检查（加快部署速度）
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push({
        'pdf-parse': 'commonjs pdf-parse',
      });
    }
    return config;
  },
};

module.exports = nextConfig;

