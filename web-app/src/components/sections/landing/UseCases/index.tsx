import { useEffect, useRef, useState } from "react";
import { renderImageBlocks } from "./MessageBlocks";

const UseCasesSection = () => {
  const containerRef = useRef(null);
  const [currentBlock, setCurrentBlock] = useState("block1");

  useEffect(() => {
    const observerOptions = {
      root: null,
      rootMargin: "0px",
      threshold: 1,
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

      console.log("-----");
      images.forEach((image, index) => {
        console.log(visibleRatio, (index + 1) * 0.1);
        if (visibleRatio >= (index + 1) * 0.1) {
          image.classList.add("image-visible");
        }

        if (visibleRatio < (index + 1) * 0.1 * 1.5) {
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
    <section className="relative">
      <div
        className="sticky px-8 top-0 container  m-auto h-[300vh] flex flex-row"
        ref={containerRef}
      >
        <div className="w-1/2 flex flex-col" id="UseCasesLeft">
          <h1 className="font-secondary text-highlightBlue text-4xl md:text-5xl font-bold">
            Index in Action
          </h1>
          <div id="block1" className="h-[75vh] flex flex-row items-center">
            <div className="flex flex-col gap-4">
              <h2 className="text-3xl font-secondary font-bold">
                Discovery for <br />{" "}
                <span className="text-highlightPink">
                  Knowledge & Social Graphs
                </span>
              </h2>
              <p className="w-3/4 font-secondary text-lg">
                Users can leverage their social connections, trust networks, and
                intents to discover new social interactions, events, and
                communities
              </p>
            </div>
          </div>

          <div id="block2" className="h-[75vh] flex flex-row items-center">
            <div className="flex flex-col gap-4">
              <h2 className="text-3xl font-secondary font-bold">
                Discovery for <br />
                <span className="text-highlightRed">Intent Graph </span>
              </h2>
              <p className="w-3/4 font-secondary text-lg">
                Users can share their intents directly with multiple autonomous
                agents, enhancing user experience and enabling discoverability
                in different contexts.
              </p>
            </div>
          </div>

          <div id="block3" className="h-[75vh] flex flex-row items-center">
            <div className="flex flex-col gap-4">
              <h2 className="text-3xl font-secondary font-bold">
                Discovery for <br />{" "}
                <span className="text-highlightPurple">Autonomous Agents</span>
              </h2>
              <p className="w-3/4 font-secondary text-lg">
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
            className="pb-40 h-[75vh] flex flex-row items-center"
          >
            <div className="flex flex-col gap-4">
              <h2 className="text-3xl font-secondary font-bold">
                Discovery for <br />
                <span className="text-highlightYellow">Conversations</span>
              </h2>
              <p className="w-3/4 font-secondary text-lg">
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
          className="w-1/2 sticky h-screen flex items-center top-0"
          id="UseCasesRight"
        >
          {renderImageBlocks(currentBlock)}
        </div>
      </div>
    </section>
  );
};

export default UseCasesSection;
