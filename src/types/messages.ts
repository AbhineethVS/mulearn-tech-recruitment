export type ChatMessage = {
  id: string
  text: string
  sentAt: string
  direction: 'incoming' | 'outgoing'
  status: 'sent' | 'delivered'
}

export type PeerEnvelope =
  | { kind: 'chat'; id: string; text: string; sentAt: string }
  | { kind: 'ack'; id: string }
  | { kind: 'typing'; active: boolean }

export type FileControlEnvelope =
  | {
      kind: 'file_meta'
      transferId: string
      name: string
      size: number
      mimeType: string
    }
  | { kind: 'file_done'; transferId: string }
  | { kind: 'file_cancel'; transferId: string }

export type FileTransfer = {
  id: string
  name: string
  size: number
  progress: number
  direction: 'incoming' | 'outgoing'
  status: 'transferring' | 'complete' | 'cancelled' | 'failed'
  url?: string
}

export type ConnectionEvent = {
  id: string
  at: string
  label: string
  detail: string
  tone: 'neutral' | 'active' | 'success' | 'danger'
}
