const BigTextSection = () => {
  return (
    <section className="mb-16 mt-8">
      <div className="m-auto max-w-screen-lg px-4 py-8 md:py-16 md:px-0">
        <div className="flex flex-col gap-6 md:gap-16">
          <h1 className="font-title text-3xl md:text-5xl">
            Index's mission is to{" "}
            <span className="text-highlightBlue">
              transform discovery into a protocol
            </span>{" "}
            and its components into networks.
            We're building{" "}
            <span className="text-highlightBlue">
              the first decentralized semantic index
            </span>
            , introducing a new open layer to information discovery.
          </h1>
          <p className="text-md md:text-lg md:w-[70%]">
            This semantic index integrates memory, intent, knowledge, and social
            graphs, enabling data to be queried from multiple sources in a
            user-centric manner. It also provides a real-time data environment
            for agents, integrating with algorithms and services, ensuring
            information remains fluid, social, and autonomous, with relevancy
            driven by competition and cooperation.
          </p>
        </div>
        <a href="#">
          <p className="mt-4 text-highlightBlue font-bold">
          Learn more ->
          </p>
        </a>
      </div>
    </section>
  );
};

export default BigTextSection;
