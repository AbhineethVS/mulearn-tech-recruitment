export type EmojiReaction = '👍' | '❤️' | '😂' | '😮' | '😢' | '🙏'

export type ReplyReference = {
  id: string
  text: string
  author: string
  authorId?: string
}

export type ChatMessage = {
  id: string
  text: string
  sentAt: string
  authorId: string
  authorName: string
  direction: 'incoming' | 'outgoing'
  status: 'sent' | 'delivered' | 'seen'
  receipts: Record<string, 'sent' | 'delivered' | 'seen'>
  editedAt?: string
  deletedAt?: string
  replyTo?: ReplyReference
  reactions: Record<string, EmojiReaction>
}

export type PeerEnvelope =
  | { kind: 'chat'; id: string; text: string; sentAt: string; replyTo?: ReplyReference }
  | { kind: 'ack'; id: string }
  | { kind: 'seen'; ids: string[] }
  | { kind: 'profile'; name: string }
  | { kind: 'reaction'; messageId: string; emoji: EmojiReaction }
  | { kind: 'message_edit'; messageId: string; text: string; editedAt: string }
  | { kind: 'message_delete'; messageId: string; deletedAt: string }
  | { kind: 'typing'; active: boolean }
  | { kind: 'call_invite'; callId: string; sentAt: string }
  | { kind: 'call_accept'; callId: string }
  | { kind: 'call_ready'; callId: string }
  | { kind: 'call_decline'; callId: string; reason?: string }
  | { kind: 'call_cancel'; callId: string }
  | { kind: 'call_end'; callId: string; reason?: string }
  | { kind: 'call_mute'; callId: string; muted: boolean }

export type CallEnvelope = Extract<PeerEnvelope, { kind: `call_${string}` }>

export type LiveCallPhase =
  | 'idle'
  | 'outgoing_ringing'
  | 'incoming_ringing'
  | 'connecting'
  | 'active'
  | 'failed'

export type LiveCallState = {
  phase: LiveCallPhase
  callId: string
  peerId: string
  peerName: string
  startedAt: number | null
  muted: boolean
  remoteMuted: boolean
  error: string
}

export type FileControlEnvelope =
  | {
      kind: 'file_meta'
      category: 'file'
      transferId: string
      name: string
      size: number
      mimeType: string
      sentAt: string
    }
  | {
      kind: 'file_meta'
      category: 'voice'
      transferId: string
      name: string
      size: number
      mimeType: string
      sentAt: string
      durationMs: number
      waveform: number[]
    }
  | { kind: 'file_done'; transferId: string }
  | { kind: 'file_cancel'; transferId: string }

export type FileTransfer = {
  id: string
  category: 'file' | 'voice'
  sentAt: string
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
