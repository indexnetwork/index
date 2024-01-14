import Button from "components/base/Button";
import Header from "components/base/Header";
import Input from "components/base/Input";
import Flex from "components/layout/base/Grid/Flex";
import { useState } from "react";
import api from "services/api-service";
import toast from "react-hot-toast";
import LandingSection from "../LandingSection";

const LandingSection7 = () => {
  const [email, setEmail] = useState("");

  const handleSubscribe = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email) {
      toast.error("Please enter a valid email address");
      return;
    }
    try {
      await toast.promise(api.subscribeToNewsletter(email), {
        loading: "Subscribing...",
        success: "Subscribed!",
        error: (err) => `${err}`,
      });
    } catch (error) {
      return;
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
        <form onSubmit={handleSubscribe}>
          <Flex className="lnd-7-form mt-8">
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              inputSize="lg"
              placeholder="Email"
            />
            <Button size="lg">Subscribe</Button>
          </Flex>
        </form>
      </div>
    </LandingSection>
  );
};

export default LandingSection7;
