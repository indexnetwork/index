import { useAtBottom } from "@/hooks/useAtBottom";
import Button from "@/components/ui/Button";
import { IconArrowDown } from "@/components/ai/ui/icons";

export function ButtonScrollToBottom({ ...props }) {
  const isAtBottom = useAtBottom();

  return (
    <Button
      onClick={() =>
        window.scrollTo({
          top: document.body.offsetHeight,
          behavior: "smooth",
        })
      }
      {...props}
    >
      <IconArrowDown />
      <span className="sr-only">Scroll to bottom</span>
    </Button>
  );
}
