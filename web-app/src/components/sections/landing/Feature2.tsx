import Abstract from "@/components/new/Icons/Abstract";
import Image from "next/image";

const FeatureSection2 = () => {
  return (
    <section>
      <div className="font-secondary m-auto flex max-w-screen-lg flex-col gap-8 px-4 md:gap-16">
        <div className="flex flex-col-reverse items-center gap-8 md:flex-row">
          <div className="flex flex-col gap-4">
            <h2 className="text-secondary text-3xl font-bold md:text-5xl">
              Composable <br /> Discovery Protocol
            </h2>
            <p className="md:w-[75%] md:text-lg">
              The composable discovery protocol of Index allows users to query
              multiple indexes together. This enables users to have an
              integrated discovery experience, ensuring responses are both
              personalized and trusted.
            </p>
            <a
              className="text-secondary"
              href="https://docs.index.network/docs/api-reference/discovery-protocol"
            >
              Learn More
            </a>
          </div>
          <Image
            alt="Composable Discovery Protocol"
            src="/images/features/2.webp"
            width={516}
            height={389}
          />
        </div>
        <div className="flex flex-col gap-8 md:flex-row">
          <div className="flex flex-1 flex-row gap-4">
            <div className="pt-1">
              <Abstract variant={4} />
            </div>
            <div className="flex flex-col gap-6">
              <h3 className="text-lg font-bold">Multi-index queries</h3>
              <p>
                Compose natural language based questions and get knowledge
                linked responses from multiple sources.
              </p>
            </div>
          </div>
          <div className="flex flex-1 flex-row gap-4">
            <div className="pt-1">
              <Abstract variant={5} />
            </div>
            <div className="flex flex-col gap-6">
              <h3 className="text-lg font-bold">Real-time listening</h3>
              <p>
                Subscribe to contexts like "tell me if something new happens
                about quantum materials
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default FeatureSection2;
