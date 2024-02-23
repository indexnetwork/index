import Button from "@/components/new/Button";
import { useRouter } from "next/navigation";

const HeroSection = () => {
  const router = useRouter();

  return (
    <section className="relative">
      <div className="m-auto flex max-w-screen-lg flex-col gap-12 lg:h-[75dvh] lg:flex-row lg:justify-end">
        <div className="bottom-0 left-0 top-0 flex items-center lg:absolute">
          <video
            autoPlay
            preload="auto"
            loop
            muted
            className="m-auto w-full pt-8 md:w-[75%] md:pt-0 lg:m-0"
          >
            <source src="/video/hero.webm" type="video/webm" />
            Your browser does not support the video tag.
          </video>
        </div>

        <div className="font-secondary z-10 flex flex-col items-center justify-center gap-4 px-8 text-center lg:w-[700px] lg:items-end lg:px-0 lg:pr-6 lg:text-end">
          <h1 className="font-title text-3xl md:text-6xl">
            Composable Discovery Protocol
          </h1>
          <p className="text-base md:text-xl">
            Index allows to create truly personalised and <br /> autonomous
            discovery experiences across the web
          </p>
          <div className="flex gap-4">
            {/* <Button onClick={connect}>Connect</Button> */}
            <Button
              variant="outline"
              onClick={() => {
                router.push("https://docs.index.network");
              }}
            >
              Read Docs
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
