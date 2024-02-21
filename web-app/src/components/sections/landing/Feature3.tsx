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
            <p className="md:text-lg">
              Index allows to create truly personalised and autonomous discovery
              experiences across the web
            </p>
            <a className="text-secondary" href="#">
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
              <h3 className="font-bold">Multi-index queries</h3>
              <p>
                Compose natural language based questions and get knowledge
                linked responses from multiple sources
              </p>
            </div>
          </div>
          <div className="flex flex-1 flex-row gap-4">
            <div className="pt-1">
              <Abstract variant={2} />
            </div>
            <div className="flex flex-col gap-6">
              <h3 className="font-bold">Semantic</h3>
              <p>
                Subscribe to contexts like "tell me if something new happens
                about quantum materials
              </p>
            </div>
          </div>
          <div className="flex flex-1 flex-row gap-4">
            <div className="pt-1">
              <Abstract variant={3} />
            </div>
            <div className="flex flex-col gap-6">
              <h3 className="font-bold">Real-time listening</h3>
              <p>
                Store, share, and discover verifiable generative information.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default FeatureSection3;
