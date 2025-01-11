import Button from "@/components/new/Button";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

const HeroSection = () => {
  const router = useRouter();
  const query = useSearchParams();

  const allowed = useMemo(() => {
    return query.get("allowed") === "true";
  }, [query.get("allowed")]);

  return (
    <section className="relative">
      <div className="m-auto flex flex-col gap-12 lg:h-[100dvh] pb-12 pt-12 md:pb-16 lg:flex-row lg:justify-start">
        <div className="relative self-center flex items-center w-full pt-4 md:mt-12 lg:mt-0 md:w-1/2  max-w-screen-lg">
          <Image
            src="/images/hero.png"
            alt="Hero"
            width={716}
            height={523}
            layout="responsive"
          />
        </div>

        <div className="lg:pt-32 font-secondary z-10 flex flex-col items-center justify-center gap-4 px-8 text-center  lg:w-[575px] lg:items-start lg:px-0 lg:pr-6 ">
          <h1 className="font-title text-center lg:text-start text-[1.9rem] leading-[2.25rem] md:text-4xl lg:text-5xl lg:leading-[3.6rem]">
            Discovery Protocol
          </h1>

          <p className="hidden text-start md:block text-base md:text-xl">
            Index allows you to create truly personalised and
            <br />
            autonomous discovery experiences across the web.
          </p>
          <p className="md:hidden text-base md:text-xl">
            Index allows you to create truly personalised and autonomous
            discovery experiences across the web.
          </p>
          <div className="flex gap-4">
            <Button onClick={() => {
              router.push("https://testflight.apple.com/join/e6sekS5x");
            }}>Download Beta App</Button>
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
