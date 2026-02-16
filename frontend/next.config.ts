import path from "node:path";
import type { NextConfig } from "next";

// Frontend project root (do not use '..' — see 2eb2d092, breaks tailwindcss resolution)
const frontendRoot = path.resolve(__dirname);

const nextConfig: NextConfig = {
  output: "standalone",
  // Absolute asset prefix so WASM URLs resolve inside Web Workers (which may
  // have an opaque/blob origin where root-relative URLs like /_next/… fail).
  assetPrefix: process.env.NEXT_PUBLIC_APP_URL || undefined,
  turbopack: {
    root: frontendRoot,
    resolveAlias: {
      // Help Turbopack locate the XMTP WASM binary
      'bindings_wasm_bg.wasm':
        './node_modules/@xmtp/wasm-bindings/dist/bindings_wasm_bg.wasm',
    },
  },
  webpack: (config) => {
    config.context = frontendRoot;
    // Handle WASM files from @xmtp/wasm-bindings loaded inside Web Workers
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });
    return config;
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
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'dev.index.network',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '3001',
        pathname: '/**',
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
      },
      {
        protocol: 'https',
        hostname: '**.storageapi.dev',
        pathname: '/**',
      }
    ],
  },
};

export default nextConfig;