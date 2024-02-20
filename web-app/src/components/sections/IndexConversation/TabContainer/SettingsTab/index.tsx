import { IconTrash } from "@/components/ai/ui/icons";
import Header from "components/base/Header";
import Text from "components/base/Text";
import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import litService from "@/services/lit-service";
import { encodeBase64 } from "ethers";
import { useApi } from "@/context/APIContext";
import { useApp } from "@/context/AppContext";
import { AccessControlCondition } from "@/types/entity";
import SettingsModal, { SettingsModalStep } from "./SettingsModal";

export interface IndexSettingsTabSectionProps {}

const IndexSettingsTabSection: React.FC<IndexSettingsTabSectionProps> = () => {
  const [conditions, setConditions] = useState<AccessControlCondition[]>([]);
  const [secretKey, setSecretKey] = useState<string | undefined>();
  const { api, ready: apiReady } = useApi();
  const { viewedIndex, createConditions } = useApp();
  const loadActionRef = React.useRef(false);

  const [showModal, setShowModal] = useState(false);
  const apiKeys = useMemo(() => conditions.filter((action: any) => action.tag === "apiKey") as any, [conditions]);

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

  useEffect(() => {
    loadKeys();
  }, []);

  const loadKeys = useCallback(async () => {
    if (!apiReady || !viewedIndex) return;
    if (loadActionRef.current) return;
    loadActionRef.current = true;

    const litActions = await api!.getLITAction(viewedIndex.signerFunction);
    if (litActions && litActions.length > 0) {
      setConditions(litActions as any);
      setApiKeys(
        litActions.filter((action: any) => action.tag === "apiKey") as any,
      );
    }

    loadActionRef.current = false;
    debugger;
  }, [apiReady, viewedIndex]);

  const handleCancel = useCallback(() => {
    setShowModal(false);
    setStep("waiting");
    setSecretKey(undefined);
  }, []);

  const handleCreate = useCallback(async () => {
    setShowModal(true);
    try {
      const authSig = await litService.getRandomAuthSig();
      const condition = {
        tag: "apiKey",
        value: {
          contractAddress: "",
          standardContractType: "",
          chain: 1,
          method: "",
          parameters: [":userAddress"],
          returnValueTest: {
            comparator: "=",
            value: authSig.address,
          },
        },
      } as any;

      const deepCopyOfConditions = JSON.parse(
        JSON.stringify(conditions),
      ) as AccessControlCondition[];

      const newConditions = [condition, ...deepCopyOfConditions];

      await createConditions(newConditions);
      setSecretKey(encodeBase64(JSON.stringify(authSig)));
      setApiKeys([...apiKeys, authSig.address]);

      setStep("done");
    } catch (e) {
      console.error(e);
    }
  }, []);

  const handleRemove = useCallback(
    (key: string) => {
      setApiKeys(apiKeys.filter((k) => k !== key));
    },
    [apiKeys],
  );

  const onDone = useCallback(() => {
    // setApiKeys([...apiKeys, secretKey!]);
    setShowModal(false);
    setStep("waiting");
    setSecretKey(undefined);
  }, [apiKeys, secretKey]);

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
              {apiKeys.map((key, i) => (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "1rem 0 ",
                    borderBottom:
                      apiKeys.length - 1 === i ? "none" : "1px solid #E2E8F0",
                  }}
                >
                  <Text> {JSON.stringify(key)}</Text>
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
