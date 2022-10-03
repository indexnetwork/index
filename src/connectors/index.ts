import { InjectedConnector } from "@web3-react/injected-connector";

const injected = new InjectedConnector({
	supportedChainIds: [1, 5],
});

const connectors = {
	injected,
};

export default connectors;
