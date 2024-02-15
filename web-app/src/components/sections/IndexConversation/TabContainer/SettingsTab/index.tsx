import { IconTrash } from "@/components/ai/ui/icons";
import Header from "components/base/Header";
import Text from "components/base/Text";
import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import React, { useCallback, useEffect, useState } from "react";
import SettingsModal, { SettingsModalStep } from "./SettingsModal";

export interface IndexSettingsTabSectionProps {}

const IndexSettingsTabSection: React.FC<IndexSettingsTabSectionProps> = () => {
  const [keys, setKeys] = useState<string[]>([]);
  const [secretKey, setSecretKey] = useState<string | undefined>();

  const [showModal, setShowModal] = useState(false);

  const [step, setStep] = useState<SettingsModalStep>("waiting");
  // const { index } = useIndex();
  // const [key, setKey] = useState<string>();
  // const getIntegrationKey = async () => {
  // 	if (!index) return;
  // 	const indexSession = await LitService.getPKPSession(index.pkpPublicKey!, index.collabAction!);
  // 	const personalSession = localStorage.getItem("did");
  // 	if (!indexSession.session || !personalSession) return;
  // 	setKey(btoa(JSON.stringify({
  // 		session: {
  // 			index: indexSession.session.serialize(),
  // 			personal: personalSession,
  // 		},
  // 		indexId: index.id!,
  // 	})));
  // };
  // useEffect(() => {
  // 	index && getIntegrationKey();
  // }, [index]);
  //

  useEffect(() => {
    loadKeys();
  }, []);

  const loadKeys = useCallback(() => {
    setKeys(["pkp_o234a67890", "pkp_1c34567890", "pkp_e234567890"]);
  }, []);

  const handleCancel = useCallback(() => {
    setShowModal(false);
    setStep("waiting");
    setSecretKey(undefined);
  }, []);

  const handleCreate = useCallback(() => {
    setShowModal(true);
    setTimeout(() => {
      const key = "pkp_your_secret_key_1234567890";
      setSecretKey(key);
      setStep("done");
    }, 1000);
  }, []);

  const handleRemove = useCallback(
    (key: string) => {
      setKeys(keys.filter((k) => k !== key));
    },
    [keys],
  );

  const onDone = useCallback(() => {
    setKeys([...keys, secretKey!]);
    setShowModal(false);
    setStep("waiting");
    setSecretKey(undefined);
  }, [keys, secretKey]);

  return (
    <>
      <SettingsModal
        step={step}
        onCancel={handleCancel}
        onDone={onDone}
        secretKey={secretKey}
        visible={showModal}
      />
      <FlexRow className={"mt-6"}>
        <Col xs={12}>
          <Header className="mb-4">API Keys</Header>
        </Col>
        <Col className="mt-6" xs={8}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1.25rem",
            }}
          >
            <Text className={"mb-4"} theme={"primary"} size="md">
              Your secret API keys are listed below. Please note that we do not
              display your secret API keys again after you generate them.
            </Text>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
              }}
            >
              {keys.map((key, i) => (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "1rem 0 ",
                    borderBottom:
                      keys.length - 1 === i ? "none" : "1px solid #E2E8F0",
                  }}
                >
                  <Text> {key}</Text>
                  <button
                    style={{
                      background: "none",
                      border: "none",
                    }}
                    onClick={() => handleRemove(key)}
                  >
                    <IconTrash width={"1rem"} height={"1rem"} />
                  </button>
                </div>
              ))}
            </div>

            <div>
              <button
                style={{
                  background: "none",
                  border: "1px solid #E2E8F0",
                  color: "#1E293B",
                  padding: "0.5rem",
                  borderRadius: "0.125rem",
                  fontWeight: 500,
                  width: "fit-content",
                }}
                onClick={handleCreate}
              >
                Create new key
              </button>
            </div>
          </div>
        </Col>
      </FlexRow>
    </>
  );
};

export default IndexSettingsTabSection;
