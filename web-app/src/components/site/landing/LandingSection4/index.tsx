import Header from "components/base/Header";
import Flex from "components/layout/base/Grid/Flex";
import React from "react";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Col from "components/layout/base/Grid/Col";
import Text from "components/base/Text";
import cm from "./style.module.scss";
import LandingSection from "../LandingSection";

const LandingSection4: React.VFC = () => {
  const [section, setSection] = React.useState("brand");
  return (
    <LandingSection dark>
      <Flex
        style={{
          position: "relative",
        }}
        className="lnd-card"
      >
        <Flex flexdirection="column" className={"mb-5"}>
          <Header className="lnd-section-title">Use cases</Header>
        </Flex>
        <FlexRow align={"center"}>
          <Col sm={12} lg={6}>
            <Flex
              flexdirection={"column"}
              className="lnd-features pr-lg-10 mr-lg-10"
            >
              <FlexRow
                className={
                  section === "documentation" ? cm.usecaseActive : cm.usecase
                }
              >
                <Header
                  onClick={() => setSection("documentation")}
                  className={"pointer mb-4"}
                >
                  Documentation
                </Header>
                <div className={cm.usecaseDetail}>
                  <Text size={"lg"}>
                    Enable builders to interact with technologies using
                    composable discovery engines.
                  </Text>
                  <ul className={"mb-0 pl-6"}>
                    <li>Ask how to integrate multiple technologies</li>
                    <li>Build with real-time, verified knowledge</li>
                  </ul>
                </div>
              </FlexRow>
              <FlexRow
                className={
                  section === "journalism" ? cm.usecaseActive : cm.usecase
                }
              >
                <Header
                  onClick={() => setSection("journalism")}
                  className={"pointer mb-4"}
                >
                  Journalism
                </Header>
                <div className={cm.usecaseDetail}>
                  <Text size={"lg"}>
                    Use composable indexes to provide readers navigate diverse
                    narratives and viewpoints in news media, promoting a
                    well-rounded understanding.
                  </Text>
                  <ul className={"mb-0 pl-6"}>
                    <li>Compare different perspectives, understand biases</li>
                    <li>Explore historical context from verified sources</li>
                    <li>Ask for facts by using fact-check indexes</li>
                  </ul>
                </div>
              </FlexRow>
              <FlexRow
                className={
                  section === "science" ? cm.usecaseActive : cm.usecase
                }
              >
                <Header
                  onClick={() => setSection("science")}
                  className={"pointer mb-4"}
                >
                  Science
                </Header>
                <div className={cm.usecaseDetail}>
                  <Text size={"lg"}>
                    Facilitate collaboration and data sharing among researchers
                    for decentralized scientific discovery.
                  </Text>
                  <ul className={"mb-0 pl-6"}>
                    <li>Bridge gaps between different research fields</li>
                    <li>Connect academia with industry partners</li>
                    <li>Engage in scientific debate</li>
                  </ul>
                </div>
              </FlexRow>
              <FlexRow
                className={
                  section === "consultancy" ? cm.usecaseActive : cm.usecase
                }
              >
                <Header
                  onClick={() => setSection("consultancy")}
                  className={"pointer mb-4"}
                >
                  Consultancy
                </Header>
                <div className={cm.usecaseDetail}>
                  <Text size={"lg"}>
                    Access and compare insights from various consulting firms.
                    Evaluate strategies, market analyses, and industry trends
                    for informed decisions.
                  </Text>
                  <ul className={"mb-0 pl-6"}>
                    <li>Expose perspectives to multiple contexts</li>
                    <li>Evaluate the business impacts of new technologies</li>
                    <li>Review diverse perspectives on trends</li>
                  </ul>
                </div>
              </FlexRow>
              <FlexRow
                className={section === "brand" ? cm.usecaseActive : cm.usecase}
              >
                <Header
                  onClick={() => setSection("brand")}
                  className={"pointer mb-4"}
                >
                  Brand + Tastemaker
                </Header>
                <div className={cm.usecaseDetail}>
                  <Text size={"lg"}>
                    Redefine how taste-makers engage with brands and humans,
                    shifting from specific brand curation to indexing personal
                    taste for authentic recommendations.
                  </Text>
                  <ul className={"mb-0 pl-6"}>
                    <li>Blend taste with products</li>
                    <li>Compose a style symphony that is uniquely yours</li>
                    <li>Uncover hidden brand synergies</li>
                  </ul>
                </div>
              </FlexRow>
            </Flex>
          </Col>
          <Col sm={12} lg={6}>
            <img
              className={cm.img}
              alt="landing-4-img"
              src={`/images/usecase-${section}.png`}
            />
          </Col>
        </FlexRow>
      </Flex>
    </LandingSection>
  );
};

export default LandingSection4;
