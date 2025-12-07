/** @type {import('next').NextConfig} */
const nextConfig = {
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

