import { useState, useEffect } from "react";

const useTypingAnimation = (words: string[], speed = 90) => {
  const [displayedText, setDisplayedText] = useState("");
  const [wordIndex, setWordIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);

  useEffect(() => {
    if (wordIndex < words.length) {
      if (charIndex < words[wordIndex].length) {
        const timeout = setTimeout(() => {
          setDisplayedText((prev) => prev + words[wordIndex].charAt(charIndex));
          setCharIndex((prev) => prev + 1);
        }, speed);
        return () => clearTimeout(timeout);
      }

      const timeout = setTimeout(() => {
        setDisplayedText("");
        setCharIndex(0);
        setWordIndex((prev) => (prev + 1) % words.length);
      }, 1000); // delay before typing the next word
      return () => clearTimeout(timeout);
    }
  }, [charIndex, wordIndex, words, speed]);

  return displayedText;
};

export default useTypingAnimation;
