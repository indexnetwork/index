import mailchimp from "@mailchimp/mailchimp_marketing";
import Web3 from "web3";
import RedisClient from "../clients/redis.js";
const redis = RedisClient.getInstance();

mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: "us8",
});

export const subscribe = async (req, res, next) => {
  const { email } = req.body;
  try {
    const response = await mailchimp.lists.addListMember(
      process.env.MAILCHIMP_LIST_ID,
      {
        email_address: email,
        status: "subscribed",
      },
    );
    res.json({
      success: true,
      message: "Subscription successful",
      data: response,
    });
  } catch (error) {
    console.error("Mailchimp subscription error:", error);
    if (error.response && error.response.body.title === "Member Exists") {
      res
        .status(400)
        .json({ success: false, message: "This email is already subscribed." });
    } else if (
      error.response &&
      error.response.body.title === "Invalid Resource"
    ) {
      res
        .status(400)
        .json({ success: false, message: "Invalid email address." });
    } else {
      const status = error.response ? error.response.status : 500;
      const message = error.response
        ? error.response.body.detail
        : "An error occurred while subscribing.";
      res.status(status).json({ success: false, message });
    }
  }
};
