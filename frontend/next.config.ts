import path from 'node:path';
import type { NextConfig } from "next";

const repoRoot = path.join(__dirname, '..');

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['protocol'],
  outputFileTracingRoot: repoRoot,
  experimental: {
    externalDir: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'i.pravatar.cc',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'avatar.vercel.sh',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'index.network',
        port: '',
        pathname: '/uploads/**',
      },
      {
        protocol: 'https',
        hostname: 'dev.index.network',
        port: '',
        pathname: '/uploads/**',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '3001',
        pathname: '/uploads/**',
      },
      {
        protocol: 'https',
        hostname: 'api.dicebear.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'avatars.slack-edge.com',
        port: '',
        pathname: '/**',
      }
    ],
  },
};

export default nextConfig;
