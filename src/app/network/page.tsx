'use client'

import { Suspense } from 'react'
import ChatContext from '@/components/chat/chatContext'
import { SideBar } from '@/components/chat/sidebar'
import useChatHook from '@/components/chat/useChatHook'
import { Header } from '@/components/header/header'
import { NeuralTopologyPanel } from '@/components/network/neural-topology-panel'

function NetworkExperience(): React.JSX.Element {
  const provider = useChatHook()

  return (
    <ChatContext.Provider value={provider}>
      <div className="bg-background flex min-h-0 flex-1 overflow-hidden">
        <SideBar />
        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-scroll">
          <Header />
          <NeuralTopologyPanel />
        </div>
      </div>
    </ChatContext.Provider>
  )
}

export default function NetworkPage(): React.JSX.Element {
  return (
    <Suspense>
      <NetworkExperience />
    </Suspense>
  )
}
