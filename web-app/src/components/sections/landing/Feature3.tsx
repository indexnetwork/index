import Abstract from "@/components/new/Icons/Abstract";
import Image from "next/image";

const FeatureSection3 = () => {
  return (
    <section>
      <div className="font-secondary m-auto flex max-w-screen-lg flex-col gap-8 px-4 md:gap-16">
        <div className="flex flex-col-reverse items-center gap-8 md:flex-row">
          <div className="flex flex-col gap-4">
            <h2 className="text-secondary text-3xl font-bold md:text-5xl">
              Real-time <br /> Discovery Agents
            </h2>
            <p className="md:w-[75%] md:text-lg">
              Index allows the automation of knowledge tasks by using AI agents
              and facilitates the composition of autonomous agents, bringing
              together a variety of economic models and methods.
            </p>
            <a
              className="text-secondary"
              href="https://docs.index.network/docs/api-reference/agents"
            >
              Learn More
            </a>
          </div>
          <Image
            alt="Real-time Discovery Agents"
            src="/images/features/3.webp"
            width={516}
            height={389}
          />
        </div>
        <div className="flex flex-col gap-8 md:flex-row">
          <div className="flex flex-1 flex-row gap-4">
            <div className="pt-1">
              <Abstract variant={1} />
            </div>
            <div className="flex flex-col gap-6">
              <h3 className="text-lg font-bold">Reactive, streaming agents</h3>
              <p>
                Invite multiple agents to automate and personalize discovery
                experiences and allow getting multiple perspectives.
              </p>
            </div>
          </div>
          <div className="flex flex-1 flex-row gap-4">
            <div className="pt-1">
              <Abstract variant={2} />
            </div>
            <div className="flex flex-col gap-6">
              <h3 className="text-lg font-bold">Open, network of agents</h3>
              <p>
                Enable thousands of agents to work together, hear each other and respond in an independent,
                self-sovereign and private way.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default FeatureSection3;
