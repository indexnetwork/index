import Button from "components/base/Button";
import Header from "components/base/Header";
import Input from "components/base/Input";
import Flex from "components/layout/base/Grid/Flex";
import { useState } from "react";
import externalApi from "services/external-api-service";
import toast from "react-hot-toast";
import LandingSection from "../LandingSection";

const LandingSection7 = () => {
  const [email, setEmail] = useState("");

  const handleSubscribe = async () => {
    if (email) {
      toast.error("Please enter a valid email address");
    }
    try {
      await toast.promise(externalApi.subscribeToNewsletter(email), {
        loading: "Subscribing...",
        success: "Subscribed!",
        error: "Something went wrong",
      });
    } catch (error) {
      toast.error(JSON.stringify({ error }));
    } finally {
      setEmail("");
    }
  };

  return (
    <LandingSection>
      <div>
        <Header className="lnd-5-title">
          Stay up to date with our newsletter
        </Header>
        <Flex className="lnd-7-form mt-8">
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            inputSize="lg"
            placeholder="Email"
          />
          <Button onClick={handleSubscribe} size="lg">
            Subscribe
          </Button>
        </Flex>
      </div>
    </LandingSection>
  );
};

export default LandingSection7;
