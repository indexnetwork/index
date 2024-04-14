export interface ThemeVariant {
  primary?: string;
  secondary?: string;
  accent?: string;
  background?: string;
  border?: string;
  pale?: string;
}

export interface Theme {
  light: ThemeVariant;
  dark: ThemeVariant;
}

export const baseTheme: Theme = {
  light: {
    primary: '#0F172A',
    secondary: '#475569',
    accent: '#bed0ec',
    background: 'white',
    border: '#E2E8F0',
    pale: '#F8FAFC',
  },
  dark: {
    primary: '#dfeaf4',
    secondary: '#e7eeff',
    accent: '#385aa3',
    background: '#0f172a',
    border: '#314969',
    pale: '#1b263e',
  },
};

export const generateAppStyles = (theme: ThemeVariant) => {
  return `
    :root {
      --primary: ${theme.primary};
      --secondary: ${theme.secondary};
      --accent: ${theme.accent};
      --background: ${theme.background};
      --border: ${theme.border};
      --pale: ${theme.pale};
    }

    ::placeholder {
      color: var(--border);
    }

    #IndexChat {
      background: var(--background);
      color: var(--primary);
    }
  `;
};

export const mergeThemes = (base: Theme, overrides?: Theme): Theme => {
  return {
    light: { ...base.light, ...overrides?.light },
    dark: { ...base.dark, ...overrides?.dark },
  };
};
