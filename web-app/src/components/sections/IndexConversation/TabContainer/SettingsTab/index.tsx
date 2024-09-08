import { useRole } from "@/hooks/useRole";
import didService from "@/services/did-service";
import Header from "components/base/Header";
import Text from "components/base/Text";
import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import Image from "next/image";
import Link from "next/link";
import React, { useCallback, useState } from "react";
import toast from "react-hot-toast";
import { useSDK } from "@metamask/sdk-react";
import { CodeSnippetReact, CodeSnippetsWithTabs } from "./CodeSnippets";
import SettingsModal, { SettingsModalStep } from "./SettingsModal";

export interface IndexSettingsTabSectionProps {}

const IndexSettingsTabSection: React.FC<IndexSettingsTabSectionProps> = () => {
  const [secretKey, setSecretKey] = useState<string | undefined>();
  const { isOwner } = useRole();
  const [showModal, setShowModal] = useState(false);
  const { provider: ethProvider, sdk } = useSDK();

  const [step, setStep] = useState<SettingsModalStep>("waiting");

  const handleCancel = useCallback(() => {
    setShowModal(false);
    setStep("waiting");
    setSecretKey(undefined);
  }, []);

  const handleCreate = useCallback(async () => {
    setShowModal(true);
    try {
      if (!ethProvider || !sdk) {
        throw new Error(`No metamask`);
      }

      const sessionResponse = await didService.getNewDIDSession(ethProvider, sdk);
      setSecretKey(sessionResponse);
      setStep("done");
    } catch (e) {
      console.error("Error creating rule", e);
      toast.error("Error creating key");
      setShowModal(false);
    }
  }, []);

  const onDone = useCallback(() => {
    setShowModal(false);
    setStep("waiting");
    setSecretKey(undefined);
  }, []);

  return (
    <div
      style={{
        overflow: "scroll",
        height: "79dvh",
        paddingBottom: "6rem",
      }}
    >
      <SettingsModal
        step={step}
        onCancel={handleCancel}
        onDone={onDone}
        secretKey={secretKey}
        visible={showModal}
      />
      {isOwner && (
        <FlexRow className={"mt-6"}>
          <Col
            xs={12}
            style={{
              marginBottom: "16px",
            }}
          >
            <Header>API Keys</Header>
          </Col>
          <Col xs={8}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1.25rem",
              }}
            >
              <div>
                <button
                  style={{
                    background: "none",
                    border: "1px solid #E2E8F0",
                    color: "#1E293B",
                    padding: "6px 8px",
                    borderRadius: "2px",
                    fontWeight: 500,
                    width: "fit-content",
                  }}
                  onClick={handleCreate}
                >
                  Generate new key
                </button>
              </div>
            </div>
          </Col>
        </FlexRow>
      )}

      <FlexRow className={"mt-8"}>
        <Col
          xs={12}
          style={{
            marginBottom: "16px",
          }}
        >
          <Header>Use your own Agent</Header>
        </Col>
        <Col xs={8}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1.25rem",
            }}
          >
            <Text className={"mb-4"} theme={"primary"} size="md">
              Here you'll find code examples to help you seamlessly integrate
              Index into your applications using Node.js, and Python.
              <br />
              <br />
              For more information, jump to{" "}
              <Link href="https://docs.index.network" target="_blank">
                documentation
              </Link>
              . Happy coding!
            </Text>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
              }}
            >
              <CodeSnippetsWithTabs />
            </div>
          </div>
        </Col>
      </FlexRow>

      <FlexRow className={"mt-8"}>
        <Col
          xs={12}
          style={{
            marginBottom: "16px",
          }}
        >
          <Header>Integrate into your App</Header>
        </Col>
        <Col xs={8}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1.25rem",
            }}
          >
            <Text className={"mb-2"} theme={"primary"} size="md">
              Embed your indexes into your application or website using the{" "}
              <Link href="https://docs.index.network" target="_blank">
                React library
              </Link>
            </Text>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
              }}
            >
              <CodeSnippetReact />
            </div>
          </div>
        </Col>
      </FlexRow>

      {isOwner && (
        <FlexRow className="mt-8">
          <Col
            xs={12}
            style={{
              marginBottom: "16px",
            }}
          >
            <Header>Integrations</Header>
          </Col>

          <Col>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "24px",
              }}
            >
              <Text
                theme={"primary"}
                size="md"
                style={{
                  maxWidth: "80%",
                }}
              >
                You can connect Index Network with lots of popular apps easily.
                This lets you make indexing automatic.
              </Text>
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: "1.2rem",
                  padding: "16px",
                  border: "1px solid #E2E8F0",
                  borderRadius: "4px",
                  maxWidth: "500px",
                }}
              >
                <Image
                  alt="Zapier"
                  src="/images/ic_zapier.svg"
                  width="40"
                  height="40"
                />
                <div
                  style={{
                    display: "flex",
                    gap: "0.25rem",
                    flexDirection: "column",
                  }}
                >
                  <p
                    style={{
                      margin: "0",
                    }}
                  >
                    <b>Zapier</b>
                  </p>
                  <p
                    style={{
                      margin: "0",
                      color: "#475569",
                      fontSize: "12px",
                    }}
                  >
                    Create integrations between Index Network and your favorite
                    apps using Zapier!{" "}
                  </p>
                </div>
                <a
                  style={{
                    background: "none",
                    border: "1px solid #E2E8F0",
                    color: "#1E293B",
                    padding: "6px 8px",
                    borderRadius: "2px",
                    fontWeight: 500,
                    width: "fit-content",
                    whiteSpace: "nowrap",
                  }}
                  target="_blank"
                  href="https://zapier.com/apps/index-network/integrations"
                >
                  Configure on Zapier
                </a>
              </div>
            </div>
          </Col>
        </FlexRow>
      )}
    </div>
  );
};

export default IndexSettingsTabSection;
