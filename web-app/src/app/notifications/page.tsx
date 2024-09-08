"use client";

import type { NextPage } from "next";
import { useState, useEffect } from "react";
import { WebPushClient } from "@magicbell/webpush";
import Head from "next/head";
import { useApi } from "@/context/APIContext";
import { useAuth } from "@/context/AuthContext";

const Notifications: NextPage = () => {
    const [client, setClient] = useState<WebPushClient | null>(null);
    const [isSubscribed, setIsSubscribed] = useState(false);
    const { api: apiService, ready: apiReady } = useApi();
    const { session, userDID } = useAuth();
    useEffect(() => {
      if (!apiReady) return;
      if (!session) return;

      const initializeWebPushClient = async () => {
        if ("serviceWorker" in navigator) {
          try {
            // Service Worker'ı kaydet
            const registration = await navigator.serviceWorker.register("/sw.js");
            console.log("Service Worker registered successfully:", registration);

            // Service Worker'ın aktif olmasını bekle
            await navigator.serviceWorker.ready;
            console.log("Service Worker is now ready");

            const profile = await apiService?.getCurrentProfile();
            if (!profile) {
              return;
            }

            console.log(profile);

            const webPushClient = new WebPushClient({
              apiKey: process.env.MAGICBELL_API_KEY || "",
              userExternalId: profile?.id,
              userHmac: profile.hmac!,
              serviceWorkerPath: "/sw.js",
            });

            setClient(webPushClient);

            const subscribed = await webPushClient.isSubscribed();
            setIsSubscribed(subscribed);
          } catch (error) {
            console.error("Error initializing WebPush:", error);
          }
        } else {
          console.error("Service Workers are not supported in this browser");
        }
      };

      initializeWebPushClient();
    }, [session, apiReady]);

    const handleSubscribe = async () => {
      if (client) {
        try {
          await client.subscribe();
          setIsSubscribed(true);
        } catch (error) {
          console.error("Subscription failed:", error);
        }
      }
    };

    const handleUnsubscribe = async () => {
      if (client) {
        try {
          await client.unsubscribe();
          setIsSubscribed(false);
        } catch (error) {
          console.error("Unsubscription failed:", error);
        }
      }
    };

    return (
        <div>
          <h1>Web Push Notifications</h1>
          {isSubscribed ? (
            <button onClick={handleUnsubscribe}>Bildirimleri Kapat</button>
          ) : (
            <button onClick={handleSubscribe}>Bilaadirimleri Aç</button>
          )}
          <Head>
            <link rel="manifest" href="/manifest.json"/>
          </Head>
        </div>
      );
};

export default Notifications;
