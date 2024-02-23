import Abstract from "@/components/new/Icons/Abstract";
import Image from "next/image";

const FeatureSection1 = () => {
  return (
    <section>
      <div className="font-secondary m-auto flex max-w-screen-lg flex-col gap-8 px-4 md:gap-16">
        <div className="flex flex-col-reverse items-center gap-8 md:flex-row">
          <div className="flex flex-col gap-4">
            <h2 className="text-secondary text-3xl font-bold md:text-5xl">
              Decentralized <br /> Semantic Index
            </h2>
            <p className="md:w-[75%] md:text-lg">
              Index stores data on a decentralized knowledge graph, making it
              queryable in natural language. By storing vector embeddings on the
              same graph, Index introduces a new open layer for information
              discovery.
            </p>
            <a
              className="text-secondary"
              href="https://docs.index.network/docs/api-reference/indexing"
            >
              Learn More
            </a>
          </div>
          <Image
            alt="Decentralized Semantic Index"
            src="/images/features/1.webp"
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
              <h3 className="text-lg font-bold">Composable</h3>
              <p>
                Index any kind of data to an open and decentralized knowledge
                graph to make it composable with blockchain backed privacy.
              </p>
            </div>
          </div>
          <div className="flex flex-1 flex-row gap-4">
            <div className="pt-1">
              <Abstract variant={2} />
            </div>
            <div className="flex flex-col gap-6">
              <h3 className="text-lg font-bold">Semantic</h3>
              <p>
                Generate & store your vector embeddings, make your data
                discoverable in an open network.
              </p>
            </div>
          </div>
          <div className="flex flex-1 flex-row gap-4">
            <div className="pt-1">
              <Abstract variant={3} />
            </div>
            <div className="flex flex-col gap-6">
              <h3 className="text-lg font-bold">Generative</h3>
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

export default FeatureSection1;
