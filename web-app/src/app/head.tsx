// nextjs head component app router paradigm

// Compare this snippet from src/app/head.tsx:
// import React from "react";

import { Metadata } from "next";
import Head from "next/head";


export default function () {
  return (
    <Head>
      <link rel="shortcut icon" href="/favicon-white.png" />
      <title>Index Network | The human bridge between context and content.</title>
      <meta name="title" content="Index Network | The human bridge between context and content." />
      <meta name="description" content="Create composable discovery engines." />

      <meta property="twitter:card" content="summary_large_image" />
      <meta property="twitter:url" content="https://index.network" />
      <meta property="twitter:title" content="Index Network | The human bridge between context and content." />
      <meta property="twitter:description" content="Create composable discovery engines." />
      <meta property="twitter:image" content="https://index.network/images/bridge.jpg" />

      <link rel="preload" as="font" href="/fonts/Freizeit-Regular.woff2" type="font/woff2" crossOrigin="anonymous" />
      <link rel="preload" as="font" href="/fonts/Freizeit-Bold.woff2" type="font/woff2" crossOrigin="anonymous" />
      <link rel="preload" as="font" href="/fonts/Roquefort-Standart.woff2" type="font/woff2" crossOrigin="anonymous" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" />
      <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&display=swap"
        rel="stylesheet" />
      <link href="/fonts/fonts.css" rel="stylesheet" />
    </Head>
  );
};