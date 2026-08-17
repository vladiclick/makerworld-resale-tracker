/** @type {import('next').NextConfig} */
const nextConfig = {
  // playwright ships native binaries: keep it external to the server bundle.
  serverExternalPackages: ['playwright', 'playwright-core'],
  images: {
    // Thumbnails are referenced by URL only, never re-hosted.
    remotePatterns: [
      { protocol: 'https', hostname: '**.makerworld.com' },
      { protocol: 'https', hostname: '**.bambulab.com' },
      { protocol: 'https', hostname: '**.mw-cdn.com' },
    ],
  },
};

export default nextConfig;
