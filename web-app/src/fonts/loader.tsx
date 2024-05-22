import localFont from "next/font/local";

const Freizeit = localFont({
  src: [
    {
      path: "../../public/fonts/Freizeit-Regular.woff2",
      weight: "normal",
      style: "normal",
    },
    {
      path: "../../public/fonts/Freizeit-Bold.woff2",
      weight: "700",
      style: "normal",
    },
  ],
});

export default Freizeit;
