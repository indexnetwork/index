import Button from "components/base/Button";
import Header from "components/base/Header";
import Input from "components/base/Input";
import Flex from "components/layout/base/Grid/Flex";
import LandingSection from "../LandingSection";

const LandingSection7 = () => {
  const handleSubscribe = () => {
    /*  //TODO: handle subscribe logic */
  };
  return (
    <LandingSection>
      <div>
        <Header className="lnd-5-title">
          Stay up to date with our newsletter
        </Header>
        <Flex className="lnd-7-form mt-8">
          <Input inputSize="lg" placeholder="Email" />
          <Button onClick={handleSubscribe} size="lg">
            Subscribe
          </Button>
        </Flex>
      </div>
    </LandingSection>
  );
};

export default LandingSection7;
