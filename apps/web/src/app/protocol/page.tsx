import { OverviewArticle } from '../overview/page';
import { protocolBodyHtml } from './protocol-body';
import './protocol.css';

export default function ProtocolPage() {
  return <OverviewArticle bodyHtml={protocolBodyHtml} pathname="/protocol" />;
}

export const Component = ProtocolPage;
