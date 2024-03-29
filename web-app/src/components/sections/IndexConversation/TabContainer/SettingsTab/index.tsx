import { IconTrash } from "@/components/ai/ui/icons";
import { useApi } from "@/context/APIContext";
import { useApp } from "@/context/AppContext";
import litService from "@/services/lit-service";
import { AccessControlCondition } from "@/types/entity";
import Header from "components/base/Header";
import Text from "components/base/Text";
import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import SettingsModal, { SettingsModalStep } from "./SettingsModal";

export interface IndexSettingsTabSectionProps {}

const IndexSettingsTabSection: React.FC<IndexSettingsTabSectionProps> = () => {
  const [conditions, setConditions] = useState<AccessControlCondition[]>([]);
  const [secretKey, setSecretKey] = useState<string | undefined>();
  const { api, ready: apiReady } = useApi();
  const { viewedIndex, createConditions } = useApp();
  const loadActionRef = React.useRef(false);

  const [showModal, setShowModal] = useState(false);
  const apiKeys = useMemo(() => {
    return conditions
      .filter((action: any) => action.tag === "apiKey")
      .map((c: any) => c.value.metadata.walletAddress) as any;
  }, [conditions]);

  const [step, setStep] = useState<SettingsModalStep>("waiting");
  const loadKeys = useCallback(async () => {
    if (!apiReady || !viewedIndex) return;
    if (loadActionRef.current) return;
    loadActionRef.current = true;

    const litActions = await api!.getLITAction(viewedIndex.signerFunction);
    if (litActions && litActions.length > 0) {
      setConditions(litActions as any);
    }

    loadActionRef.current = false;
  }, [api, apiReady, viewedIndex]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

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
          chain: "ethereum",
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
      setSecretKey(btoa(JSON.stringify(authSig)));
      setStep("done");
    } catch (e) {
      console.error("Error creating rule", e);
      toast.error("Error creating key");
      setShowModal(false);
    }
  }, [conditions, createConditions]);

  const handleRemove = useCallback(
    async (key: string) => {
      if (!apiReady) return;
      setShowModal(true);

      try {
        const deepCopyOfConditions = JSON.parse(JSON.stringify(conditions));

        console.log("in remove deepCopyOfConditions", deepCopyOfConditions);
        const newConditions = deepCopyOfConditions.filter(
          (c: any) => c.value.metadata.walletAddress !== key,
        );

        console.log("in remove", newConditions);
        await createConditions(newConditions);
        toast.success("Key removed");
        setShowModal(false);
      } catch (error) {
        console.error("Error removing rule", error);
        setShowModal(false);
        toast.error("Error removing key");
      }
    },
    [apiReady, conditions, createConditions],
  );

  const onDone = useCallback(() => {
    setShowModal(false);
    setStep("waiting");
    setSecretKey(undefined);
  }, []);

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
              {apiKeys.map((key: any, i: number) => (
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
