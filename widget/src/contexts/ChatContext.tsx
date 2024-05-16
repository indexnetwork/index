import {
  createContext,
  useContext,
  useState,
  ReactNode,
  useCallback,
  useEffect,
} from "react";
import { IndexStatus, Message, Participant, ParticipantProfile } from "@/types";
import { ApiService } from "@/services/api-service";
import { appConfig } from "@/config";
import { v4 as uuidv4 } from "uuid";
import { normalizeAccountId } from "@ceramicnetwork/common";
import { Cacao, SiweMessage } from "@didtools/cacao";
import { getAccountId } from "@didtools/pkh-ethereum";
import { getAddress } from "ethers";
import { randomBytes, randomString } from "@stablelib/random";
import { DIDSession, createDIDCacao, createDIDKey } from "did-session";

export interface ChatContextType {
  messages: Message[];
  sources?: string[];
  chatID: string | undefined;
  defaultQuestions: string[];
  status: IndexStatus;
  sendMessage: (content: string) => Promise<void>;
  initializeChat: () => void;
  isLoading: boolean;
  session?: DIDSession | null;
  connectWallet: () => void;
  clearMessages: () => void;
  userProfile: ParticipantProfile | undefined;
  viewedProfile: ParticipantProfile | undefined;
}

interface ChatProviderProps {
  children: ReactNode;
  sources?: string[];
}

const defaultContext = {
  messages: [],
  chatID: undefined,
  sources: [],
  sendMessage: async () => {},
  initializeChat: () => {},
  defaultQuestions: [],
  isLoading: false,
  session: null,
  connectWallet: () => {},
  status: IndexStatus.Init,
  clearMessages: () => {},
  userProfile: undefined,
  viewedProfile: undefined,
};

const ChatContext = createContext<ChatContextType>(defaultContext);

const SESSION_KEY = "index-chat-did-session";

export const useIndexChat = () => useContext(ChatContext);

export const ChatProvider: React.FC<ChatProviderProps> = ({
  children,
  sources: sourcesInput,
}) => {
  const [session, setSession] = useState<DIDSession | undefined>();

  const [messages, setMessages] = useState<Message[]>([]);
  const [sources, setSources] = useState<string[]>(sourcesInput || []);
  const [defaultQuestions, setDefaultQuestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  // const [isWalletConnected, setIsWalletConnected] = useState<boolean>(false);
  const [status, setStatus] = useState<IndexStatus>(IndexStatus.Init);
  const [userProfile, setUserProfile] = useState<
    ParticipantProfile | undefined
  >();
  const [viewedProfile, setViewedProfile] = useState<
    ParticipantProfile | undefined
  >();
  const [chatID, setChatID] = useState<string>(uuidv4());

  const apiService = new ApiService({ baseUrl: appConfig.apiUrl, session });
  const fetchProfile = useCallback(
    async (did: string) => {
      const userProfile = await apiService.fetchProfile(did);
      console.log("userProfile", userProfile);
      setUserProfile(userProfile);
    },
    [session],
  );

  useEffect(() => {
    if (session) {
      fetchProfile(session?.did?.parent);
    }
  }, [session]);

  const consumeStream = useCallback(
    async (messages: Message[]) => {
      setIsLoading(true);
      try {
        for await (const chunk of apiService.streamMessages(
          messages,
          sources,
          chatID,
        )) {
          setMessages((prevMessages) => {
            const lastIndex = prevMessages.length - 1;
            const updatedMessages = [...prevMessages];
            updatedMessages[lastIndex] = {
              ...updatedMessages[lastIndex],
              content: updatedMessages[lastIndex].content + chunk,
            };
            return updatedMessages;
          });
        }
      } catch (error) {
        console.error("Error while streaming messages:", error);
      } finally {
        setIsLoading(false);
      }
    },
    [apiService],
  );

  const sendMessage = useCallback(
    async (userContent: string) => {
      const newMessage: Message = {
        content: userContent,
        role: Participant.User,
      };
      const updatedMessages = [
        ...messages,
        newMessage,
        { content: "", role: Participant.Assistant },
      ];
      setMessages(updatedMessages);
      consumeStream([...messages, newMessage]);
    },
    [messages, consumeStream],
  );

  const initializeChat = async () => {
    try {
      const indexData = await apiService.fetchIndex(sources[0]);
      const defaultQuestions = await apiService.getDefaultQuestionsOfIndex(
        sources[0],
      );

      setDefaultQuestions(defaultQuestions.slice(0, 2));
      setViewedProfile({
        id: indexData.id,
        name: indexData.ownerDID.name,
        avatar: `${appConfig.ipfsGateway}/${indexData.ownerDID.avatar}` as any,
        bio: indexData.ownerDID.bio,
      });
      setStatus(IndexStatus.Success);
    } catch (error) {
      console.error("Error while initializing:", error);
      setStatus(IndexStatus.Fail);
    }
  };

  const clearMessages = () => {
    setMessages([]);
  };

  const startSession = useCallback(async (): Promise<void> => {
    const ethProvider = window.ethereum;

    // if (ethProvider.chainId !== appConfig.testNetwork.chainId) {
    /*const switchRes = await switchTestNetwork();
      if (!switchRes) {
        throw new Error("Network error.");
        }*/
    // }

    // request ethereum accounts.
    const addresses = await ethProvider.enable({
      method: "eth_requestAccounts",
    });

    const accountId = await getAccountId(ethProvider, addresses[0]);
    const normAccount = normalizeAccountId(accountId);
    const keySeed = randomBytes(32);
    const didKey = await createDIDKey(keySeed);

    const now = new Date();
    const twentyFiveDaysLater = new Date(
      now.getTime() + 25 * 24 * 60 * 60 * 1000,
    );

    const siweMessage = new SiweMessage({
      domain: window.location.host,
      address: getAddress(normAccount.address),
      statement: "Give this application access to some of your data on Ceramic",
      uri: didKey.id,
      version: "1",
      chainId: "1",
      nonce: randomString(10),
      issuedAt: now.toISOString(),
      expirationTime: twentyFiveDaysLater.toISOString(),
      resources: ["ceramic://*"],
    });

    siweMessage.signature = await ethProvider.request({
      method: "personal_sign",
      params: [siweMessage.signMessage(), getAddress(accountId.address)],
    });

    const cacao = Cacao.fromSiweMessage(siweMessage);
    const did = await createDIDCacao(didKey, cacao);
    const newSession = new DIDSession({ cacao, keySeed, did });

    localStorage.setItem(SESSION_KEY, newSession.serialize());
    setSession(newSession);
    console.log("Session started:", newSession);
  }, []);

  return (
    <ChatContext.Provider
      value={{
        status,
        session,
        connectWallet: startSession,
        messages,
        sendMessage,
        initializeChat,
        isLoading,
        clearMessages,
        userProfile,
        viewedProfile,
        defaultQuestions,
        sources,
        chatID,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export default ChatContext;
