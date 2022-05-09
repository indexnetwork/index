import { InjectedConnector } from "@web3-react/injected-connector";

const injected = new InjectedConnector({
	supportedChainIds: [1, 3, 4, 5, 42],
});

const connectors = {
	injected,
};

export default connectors;
