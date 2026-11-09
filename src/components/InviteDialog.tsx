import { Check, Copy, QrCode, Share2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const input = document.createElement('textarea')
  input.value = value
  input.setAttribute('readonly', '')
  input.style.position = 'fixed'
  input.style.opacity = '0'
  document.body.append(input)
  input.select()
  document.execCommand('copy')
  input.remove()
}

export function InviteDialog({
  open,
  roomCode,
  roomType,
  inviteUrl,
  onClose,
}: {
  open: boolean
  roomCode: string
  roomType: 'private' | 'group'
  inviteUrl: string
  onClose: () => void
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [shareError, setShareError] = useState('')
  const closeDialog = useCallback(() => {
    setCopyState('idle')
    setShareError('')
    onClose()
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDialog()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [closeDialog, open])

  if (!open) return null

  const shareSupported = 'share' in navigator && typeof navigator.share === 'function'

  const copyInvite = async () => {
    await copyText(inviteUrl)
    setCopyState('copied')
    window.setTimeout(() => setCopyState('idle'), 1_800)
  }

  const shareInvite = async () => {
    setShareError('')
    if (!shareSupported) {
      await copyInvite()
      return
    }
    try {
      await navigator.share({
        title: `Join my P4Pair ${roomType} room`,
        text: `Join room ${roomCode} for a peer-to-peer ${roomType} chat.`,
        url: inviteUrl,
      })
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return
      try {
        await copyInvite()
        setShareError('Sharing was unavailable, so the invitation was copied instead.')
      } catch {
        setShareError('This browser could not share or copy the invitation.')
      }
    }
  }

  return (
    <div className="invite-backdrop" onClick={closeDialog}>
      <section
        className="invite-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="invite-dialog-icon"><QrCode size={19} /></span>
            <span>
              <small>Room {roomCode}</small>
              <h2 id="invite-dialog-title">Invite another browser</h2>
            </span>
          </div>
          <button type="button" onClick={closeDialog} aria-label="Close invitation" autoFocus>
            <X size={18} />
          </button>
        </header>

        <div className="invite-dialog-body">
          <div className="invite-qr" aria-label="QR code containing the room invitation">
            <QRCodeSVG
              value={inviteUrl}
              size={208}
              level="M"
              marginSize={2}
              bgColor="#ffffff"
              fgColor="#142023"
            />
          </div>
          <div className="invite-copy">
            <p>
              Scan this code with another device, or share the {roomType} room link.
            </p>
            <code>{roomCode}</code>
            <span title={inviteUrl}>{inviteUrl}</span>
          </div>
        </div>

        {shareError && <p className="invite-share-status" role="status">{shareError}</p>}

        <footer>
          <button type="button" className="invite-copy-button" onClick={() => void copyInvite()}>
            {copyState === 'copied' ? <Check size={17} /> : <Copy size={17} />}
            {copyState === 'copied' ? 'Copied' : 'Copy link'}
          </button>
          <button type="button" className="invite-share-button" onClick={() => void shareInvite()}>
            <Share2 size={17} />
            {shareSupported ? 'Share invite' : 'Copy invite'}
          </button>
        </footer>
      </section>
    </div>
  )
}
