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
      category: 'file'
      transferId: string
      name: string
      size: number
      mimeType: string
    }
  | {
      kind: 'file_meta'
      category: 'voice'
      transferId: string
      name: string
      size: number
      mimeType: string
      durationMs: number
      waveform: number[]
    }
  | { kind: 'file_done'; transferId: string }
  | { kind: 'file_cancel'; transferId: string }

export type FileTransfer = {
  id: string
  category: 'file' | 'voice'
  name: string
  size: number
  durationMs?: number
  waveform?: number[]
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
