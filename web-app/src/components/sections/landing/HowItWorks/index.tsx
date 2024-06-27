import { useState } from "react";
import HowItWorksContent from "./Content";
import data from "./data";

const HowItWorksSection = () => {
  const [activeTab, setActiveTab] = useState(0);
  const tabTitles = [
    "Create an index",
    "Query multiple indexes",
    "Multi-agent conversations",
    "Contextual subscriptions",
  ];

  return (
    <section className="">
      <div className="container m-auto flex flex-col max-lg:py-16 md:py-36 px-4 gap-8">
        <h1 className="font-secondary text-highlightBlue text-3xl md:text-5xl font-bold">
          How it works
        </h1>
        <header className="my-6 ">
          <div className="flex flex-row flex-wrap gap-4 ">
            {tabTitles.map((title, index) => (
              <button
                key={index}
                onClick={() => setActiveTab(index)}
                className={`text-md border font-bold rounded-full px-4 py-3 transition-all duration-300 ${
                  activeTab === index
                    ? "bg-white text-mainDark  border-white shadow-lg"
                    : "text-white border-grey-500"
                }`}
              >
                {title}
              </button>
            ))}
          </div>
        </header>
        <div>
          <HowItWorksContent data={data[activeTab]} />
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
