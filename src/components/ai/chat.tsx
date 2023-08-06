'use client'

import { useChat, type Message } from 'ai/react'

import cc from "classcat";
import { ChatList } from 'components/ai/chat-list'
import { ChatPanel } from 'components/ai/chat-panel'
import { EmptyScreen } from 'components/ai/empty-screen'
import { ChatScrollAnchor } from 'components/ai/chat-scroll-anchor'

import { toast } from 'react-hot-toast'

export interface ChatProps extends React.ComponentProps<'div'> {
  initialMessages?: Message[]
  id?: string
}

export function Chat({ id, initialMessages, className }: ChatProps) {

  const apiUrl = "http://localhost:8000/index/seref/chat_stream"

  const { messages, append, reload, stop, isLoading, input, setInput } =
    useChat({
      api: apiUrl,
      initialMessages,
      id,
      body: {
        id,
      },
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      onResponse(response) {
        if (response.status === 401) {
          toast.error(response.statusText)
        }
      }
    })
  return (
    <>
      <div className={cc('pb-[200px] pt-4 md:pt-10', className)}>
        {messages.length ? (
          <>
            <ChatList messages={messages} />
            <ChatScrollAnchor trackVisibility={isLoading} />
          </>
        ) : (
          <EmptyScreen setInput={setInput} />
        )}
      </div>
      <ChatPanel
        id={id}
        isLoading={isLoading}
        stop={stop}
        append={append}
        reload={reload}
        messages={messages}
        input={input}
        setInput={setInput}
      />
    </>
  )
}
