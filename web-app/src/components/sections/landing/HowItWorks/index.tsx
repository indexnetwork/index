import { useState } from "react";
import HowItWorksContent from "./Content";
import data from "./data";

const HowItWorksSection = () => {
  const [activeTab, setActiveTab] = useState(0);
  const tabTitles = [
    "Create an index",
    "Query multiple items",
    "Multi-agent conversation",
    "Contextual subscriptions",
  ];

  return (
    <section className="mt-16 pb-16">
      <div className="container m-auto flex flex-col px-4 gap-8">
        <h1 className="font-secondary text-highlightBlue text-4xl md:text-5xl font-bold">
          How it works
        </h1>
        <header className="mb-4">
          <div className="flex flex-row flex-wrap gap-4 md:gap-8">
            {tabTitles.map((title, index) => (
              <button
                key={index}
                onClick={() => setActiveTab(index)}
                className={`text-md border rounded-full px-4 py-3 transition-all duration-300 ${
                  activeTab === index
                    ? "bg-white text-mainDark font-bold border-white shadow-lg"
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
