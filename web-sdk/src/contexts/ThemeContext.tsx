import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Theme, ThemeVariant, baseTheme, generateAppStyles, mergeThemes } from '@/lib/theme';

export interface ThemeProps {
  darkMode: boolean;
  theme?: Theme;
}

export interface ThemeContextType {
  activeTheme: ThemeVariant;
  darkMode: boolean;
  toggleDarkMode: () => void;
}

const defaultThemeContext: ThemeContextType = {
  activeTheme: baseTheme.light,
  darkMode: false,
  toggleDarkMode: () => { },
};

const ThemeContext = createContext<ThemeContextType>(defaultThemeContext);

export const ThemeProvider: React.FC<{ children: ReactNode, style?: ThemeProps }> = ({ children, style }) => {
  const [darkMode, setDarkMode] = useState(style?.darkMode ?? defaultThemeContext.darkMode);
  const [theme] = useState<Theme>(mergeThemes(baseTheme, style?.theme))

  const [activeTheme, setActiveTheme] = useState<ThemeVariant>(darkMode ? theme.dark : theme.light);

  useEffect(() => {
    const storedDarkMode = localStorage.getItem('darkMode') === 'true';
    setDarkMode(storedDarkMode);
  }, []);

  useEffect(() => {
    localStorage.setItem('darkMode', darkMode.toString());
    setActiveTheme(darkMode ? theme.dark : theme.light);
  }, [darkMode]);

  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
  };

  return (
    <ThemeContext.Provider value={{ activeTheme, darkMode, toggleDarkMode }}>
      {children}
      <style>{generateAppStyles(activeTheme)}</style>
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);

export default ThemeContext;
