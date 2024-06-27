import Button from "@/components/new/Button";
import { useAuth } from "@/context/AuthContext";
import useTypingAnimation from "@/hooks/useTypingAnimation";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

const HeroSection = () => {
  const router = useRouter();
  const query = useSearchParams();
  const { connect } = useAuth();

  const words = [
    "AI Agents",
    "Web3 Builders",
    "Networks",
    "Ecosystems",
    "Curious People",
    "Communities",
  ];
  const typingText = useTypingAnimation(words);

  const allowed = useMemo(() => {
    return query.get("allowed") === "true";
  }, [query.get("allowed")]);

  return (
    <section
      className="relative"
      style={{
        backgroundImage: "url(/images/hero-bg.png)",
        // cover
        backgroundSize: "cover",
      }}
    >
      <div className="m-auto flex max-w-screen-lg flex-row gap-12 h-[80dvh] items-center lg:h-[100dvh] pb-24 pt-48 md:pb-10 lg:flex-row ">
        <div className="font-secondary z-10 flex flex-col justify-center gap-4 px-8  lg:px-0 lg:pr-6 ">
          <h1 className="hidden md:block font-title text-[1.9rem] leading-[2.25rem] md:text-7xl md:leading-[5.2rem]">
            The First Discovery Protocol <br /> for{" "}
            <span className="text-highlightBlue">{typingText}|</span>
          </h1>
          <h1 className="md:hidden font-title text-[1.9rem] leading-[2.25rem] md:text-6xl md:leading-[4.5rem]">
            The First <br />
            Discovery Protocol <br /> for{" "}
            <span className="text-highlightBlue">{typingText}|</span>
          </h1>

          <p className="hidden md:block text-base md:text-xl">
            Index allows you to create truly personalised and <br /> autonomous
            discovery experiences across the web
          </p>
          <p className="md:hidden text-base md:text-xl">
            Index allows you to create truly personalised and autonomous
            discovery experiences across the web
          </p>
          <div className="flex gap-4 pt-4">
            {allowed && <Button onClick={connect}>Connect</Button>}
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
