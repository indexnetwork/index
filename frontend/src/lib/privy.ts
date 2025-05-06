import { PrivyClientConfig } from '@privy-io/react-auth';

// Configure Privy client
export const privy: PrivyClientConfig = {
  loginMethods: ['email', 'google', 'wallet'],
  appearance: {
    theme: 'light',
    accentColor: '#000000', // amber-500 to match your theme
    showWalletLoginFirst: false,
  },
}; 