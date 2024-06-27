import { useApi } from "@/context/APIContext";
import { useCallback, useState } from "react";
import toast from "react-hot-toast";

const SubscribeSection = () => {
  const [email, setEmail] = useState("");
  const { api } = useApi();

  const handleSubscribe = useCallback(async () => {
    if (!api) return;

    if (!email) {
      toast.error("Please enter a valid email address");
      return;
    }
    try {
      await toast.promise(api!.subscribeToNewsletter(email), {
        loading: "Subscribing...",
        success: "Subscribed!",
        error: (err) => `${err}`,
      });
    } catch (error) {
      return;
    } finally {
      setEmail("");
    }
  }, [api, email]);

  return (
    <section>
      <div className="flex flex-col items-center justify-center gap-8 py-16 text-center md:py-24">
        <h2 className="font-title  text-xl md:text-3xl">
          Stay up to date with our newsletter
        </h2>
        <div className="rounded-sm border">
          <input
            className="bg-transparent px-4 py-2"
            value={email}
            onChange={(e: any) => setEmail(e.target.value)}
            placeholder="Email"
          />
          <button
            className="bg-primary text-passiveDark px-4 py-2"
            onClick={handleSubscribe}
          >
            Subscribe
          </button>
        </div>
      </div>
    </section>
  );
};

export default SubscribeSection;
