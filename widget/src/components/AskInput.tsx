import React from "react";
import { useEnterSubmit } from "@/hooks/useEnterSubmit";
import IconSend from "@/components/ui/Icon/IconSend";
import TextArea from "@/components/ui/TextArea";
import Icon from "@/assets/icon";

export interface AskInputProps {
  onSubmit: (value: string) => Promise<void>;
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  contextMessage: string;
}

const AskInput = ({
  onSubmit,
  input,
  setInput,
  isLoading,
  contextMessage,
  ...inputProps
}: AskInputProps) => {
  const { formRef, onKeyDown } = useEnterSubmit();
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  return (
    // <div className="self-stretch pt-4">
    //   <div className="relative flex">
    <form
      className="w-full"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!input?.trim()) {
          return;
        }
        setInput("");
        await onSubmit(input);
      }}
      ref={formRef}
    >
      {/* <TextArea
        ref={inputRef}
        value={input}
        rows={1}
        maxRows={8}
        onKeyDown={onKeyDown}
        className="text-primary border-default dynamic-placeholder dynamic-input disabled:bg-grey-200 h-fit w-full rounded border
                        bg-transparent py-2.5 pl-2.5 pr-10 text-sm ring-opacity-50 transition-shadow duration-300 ease-in-out focus:shadow-md focus:outline-none "
        onChange={(e: any) => setInput(e.target.value)}
        inputSize={"md"}
        addOnAfter={
          <IconSend
            className={input.length > 0 ? "typing" : "add-on-after-icon"}
            cursor="pointer"
            onClick={async () => {
              if (!input?.trim()) {
                return;
              }
              setInput("");
              await onSubmit(input);
            }}
            width={20}
            height={20}
          />
        }
        spellCheck={false}
        placeholder={`Ask to ${contextMessage}`}
      /> */}
      <div className="self-stretch pt-4">
        <div className="relative flex">
          <textarea
            rows={1}
            aria-label="ask-input"
            onChange={(e: any) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            value={input}
            ref={inputRef}
            style={{
              resize: "none",
              maxHeight: "6rem",
            }}
            className="text-primary border-default dynamic-placeholder dynamic-input disabled:bg-grey-200 h-fit w-full rounded border
              bg-transparent py-2.5 pl-2.5 pr-10 text-sm ring-opacity-50 transition-shadow duration-300 ease-in-out focus:shadow-md focus:outline-none "
            placeholder="Ask to all indexes"
          />
          <button
            onClick={async () => {
              if (!input?.trim()) {
                return;
              }
              setInput("");
              await onSubmit(input);
            }}
            className="absolute bottom-0 right-3 top-0 m-auto"
          >
            <Icon.SendMessage />
          </button>
        </div>
      </div>
    </form>
    //   </div>
    // </div>
  );
};

export default AskInput;
