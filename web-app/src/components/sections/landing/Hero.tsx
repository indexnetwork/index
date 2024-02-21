import Button from "@/components/new/Button";
import { useRouter } from "next/navigation";

const HeroSection = () => {
  const router = useRouter();

  return (
    <section className="relative">
      <div className="m-auto flex h-screen max-w-screen-lg flex-col gap-12 md:flex-row md:justify-end">
        {/* <div>
        <video src="/video/hero.webm" />
      </div> */}
        <div className="bottom-0 left-0 top-0 flex items-center md:absolute">
          <video
            autoPlay
            preload="auto"
            loop
            className="h-auto w-full md:w-auto"
          >
            <source src="/video/hero.webm" type="video/webm" />
            Your browser does not support the video tag.
          </video>
        </div>

        <div className="font-secondary z-10 flex flex-col items-center justify-center gap-4 text-center md:w-[50%] md:items-end md:text-end">
          <h1 className="text-3xl md:text-6xl">
            The Composable Discovery Protocol
          </h1>
          <p className="text-base">
            Index allows to create truly personalised and autonomous discovery
            experiences across the web
          </p>
          <div className="flex gap-4">
            <Button
              onClick={() => {
                router.push("/auth");
              }}
            >
              Connect
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                router.push("/auth");
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
