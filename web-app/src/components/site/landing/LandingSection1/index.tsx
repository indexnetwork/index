"use client";

import { useAuth } from "@/context/AuthContext";
import cc from "classcat";
import Button from "components/base/Button";
import Header from "components/base/Header";
import Text from "components/base/Text";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import FlexRow from "components/layout/base/Grid/FlexRow";
import LandingSection from "../LandingSection";
import cm from "./style.module.scss";

const LandingSection1 = () => {
  const { connect } = useAuth();

  const handleConnect = async () => {
    try {
      await connect();
    } catch (err) {
      console.log(err);
    }
  };

  return (
    <LandingSection first>
      <FlexRow align={"center"} fullWidth justify={"between"}>
        <Col sm={12} md={6}>
          <Flex
            flexdirection={"column"}
            alignitems={"left"}
            className={cc([" lnd-card lnd-first", cm.container])}
          >
            <Header className={cm.lndBlueTtl}>
              {" "}
              The human bridge between context and content
            </Header>
            <Text
              style={{ fontSize: "2.4rem", lineHeight: "1.50" }}
              className={cc([cm.descLine, "mr-lg-10 pr-lg-10 mb-6", "mb-sm-7"])}
            >
              Index allows you to create truly personalised and autonomous discovery experiences across the web
            </Text>
            <Button theme="primary" onClick={handleConnect}>
              Connect Wallet
            </Button>
          </Flex>
        </Col>
        <Col sm={12} md={6}>
          <Flex alignitems={"right"}>
            <video
              autoPlay
              loop
              muted
              playsInline
              className={cm.video}
              style={{}}
            >
              <source src="/video/mainani-white.webm" type="video/mp4" />
            </video>
          </Flex>
        </Col>
      </FlexRow>
    </LandingSection>
  );
};

export default LandingSection1;
