import { useEffect, useRef, useState } from "react";
import { renderImageBlocks } from "./MessageBlocks";

const UseCasesSection = () => {
  const containerRef = useRef(null);
  const [currentBlock, setCurrentBlock] = useState("block1");

  useEffect(() => {
    const handleScroll = () => {
      const container: any = containerRef.current;
      if (!container) return;

      const containerBoundingRect = container.getBoundingClientRect();
      const rightContainer = document.getElementById("UseCasesRight");

      if (containerBoundingRect.top <= 0) {
        rightContainer?.classList.add("sticky");
      } else {
        rightContainer?.classList.remove("sticky");
      }
    };

    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    const isMobile = window.innerWidth < 768;
    const observerOptions = {
      root: null,
      rootMargin: "0px",
      threshold: isMobile ? 1 : 0.7,
    };

    const observerCallback = (entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setCurrentBlock(entry.target.id);
        }
      });
    };

    const observer = new IntersectionObserver(
      observerCallback,
      observerOptions,
    );

    const targets = document.querySelectorAll("#UseCasesLeft > div");
    targets.forEach((target) => observer.observe(target));

    return () => {
      targets.forEach((target) => observer.unobserve(target));
    };
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const currentBlockElement = document.getElementById(currentBlock);
      if (!currentBlockElement) return;

      const boundingRect = currentBlockElement.getBoundingClientRect();

      const images = document.querySelectorAll(
        `#UseCasesRight .image-container img`,
      );

      const blockHeight = currentBlockElement.clientHeight;
      const visibleRatio = Math.min(
        1,
        Math.max(0, (window.innerHeight - boundingRect.top) / blockHeight),
      );

      // console.log("-----");
      // console.log(currentBlock);

      const isMobile = window.innerWidth < 768;
      images.forEach((image, index) => {
        // console.log(visibleRatio, 0.71);
        if (isMobile) {
          image.classList.add("image-visible");
          return;
        }
        if (index === 0) {
          image.classList.add("image-visible");
          return;
        }

        if (visibleRatio >= 0.72 + index * (0.24 / images.length)) {
          // console.log("adding class", image);
          image.classList.add("image-visible");
        } else {
          // console.log("removing class", image);
          image.classList.remove("image-visible");
        }
      });
    };

    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [currentBlock]);

  return (
    <section className="relative" id="UseCases">
      <div
        className="pt-12 md:pt-16 md:px-8 md:container m-auto h-[368dvh] md:h-[300dvh] md:flex  md:flex-row"
        ref={containerRef}
      >
        <div className="px-4 w-full md:w-1/2 flex flex-col" id="UseCasesLeft">
          <h1 className="font-secondary pb-8 text-highlightBlue text-4xl md:text-5xl font-bold">
            Index in Action
          </h1>
          <p className="font-secondary text-lg md:text-xl">
            Index, as a discovery primitive, makes many different use-cases
            possible, ranging from science, journalism, e-commerce, social and
            many more. <br />
            <br />
            Here are four examples that we are most excited about:
          </p>
          <div id="block1" className="h-[75dvh] flex flex-row items-center">
            <div className="flex flex-col gap-4">
              <h2 className="text-3xl font-secondary font-bold">
                Discovery for <br />{" "}
                <span className="text-highlightPink">
                  Knowledge & Social Graphs
                </span>
              </h2>
              <p className="sm:w-full md:w-3/4 font-secondary text-lg">
                Users can leverage their social connections, trust networks, and
                intents to discover new social interactions, events, and
                communities
              </p>
            </div>
          </div>

          <div id="block2" className="h-[75dvh] flex flex-row items-center">
            <div className="flex flex-col gap-4">
              <h2 className="text-3xl font-secondary font-bold">
                Discovery for <br />
                <span className="text-highlightRed">Intent Graph </span>
              </h2>
              <p className="sm:w-full md:w-3/4 font-secondary text-lg">
                Users can share their intents directly with multiple autonomous
                agents, enhancing user experience and enabling discoverability
                in different contexts.
              </p>
            </div>
          </div>

          <div id="block3" className="h-[75dvh] flex flex-row items-center">
            <div className="flex flex-col gap-4">
              <h2 className="text-3xl font-secondary font-bold">
                Discovery for <br />{" "}
                <span className="text-highlightPurple">Autonomous Agents</span>
              </h2>
              <p className="sm:w-full md:w-3/4 font-secondary text-lg">
                Agents can discover and collaborate with other agents, discuss
                specific tasks, and utilize their reputations. specific tasks,
                and utilize their reputations. <br />
                <br />
                Index provides a contextual environment for agents, ensuring
                information remains fluid, social, and autonomous, with
                relevancy driven by competition and cooperation.
              </p>
            </div>
          </div>

          <div
            id="block4"
            className="md:pb-72 h-[75dvh] flex flex-row items-center"
          >
            <div className="flex flex-col gap-4">
              <h2 className="text-3xl font-secondary font-bold">
                Discovery for <br />
                <span className="text-highlightYellow">Conversations</span>
              </h2>
              <p className="sm:w-full md:w-3/4 font-secondary text-lg">
                Initiate public conversations that are contextually discoverable
                by others, making each conversation visible within other
                people's conversations or anywhere else it is contextually
                relevant.
              </p>
            </div>
          </div>
        </div>
        {/* Right */}
        <div
          className="bg-[#303c56] md:bg-transparent bottom-0 md:top-0 w-full md:w-1/2  h-[50dvh] md:h-screen flex items-center "
          id="UseCasesRight"
        >
          <div className="px-4 md:px-0">{renderImageBlocks(currentBlock)}</div>
        </div>
      </div>
    </section>
  );
};

export default UseCasesSection;
