import { PrivyClient } from '@privy-io/server-auth';



export const privyClient = new PrivyClient(
  process.env.PRIVY_APP_ID || "",
  process.env.PRIVY_APP_SECRET || ""
);

// Types for Privy authentication
export interface PrivyUser {
  id: string;
  email?: {
    address: string;
  };
  wallet?: {
    address: string;
    chain_type: string;
  };
  created_at: number;
}

export interface AuthenticatedPrivyUser {
  id: string;
  email: string | null;
  name: string;
  avatar: string | null;
  privyId: string;
} 