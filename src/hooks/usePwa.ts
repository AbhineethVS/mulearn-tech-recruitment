import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function usePwa() {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [updateWorker, setUpdateWorker] = useState<ServiceWorker | null>(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [iosHintDismissed, setIosHintDismissed] = useState(false)
  const refreshingRef = useRef(false)

  const standalone = useMemo(
    () =>
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    [],
  )
  const isIos = useMemo(
    () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone,
    [standalone],
  )

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }
    const handleInstalled = () => setInstallPrompt(null)
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    const handleControllerChange = () => {
      if (!refreshingRef.current) return
      window.location.reload()
    }

    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    navigator.serviceWorker?.addEventListener('controllerchange', handleControllerChange)

    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/service-worker.js').then((registration) => {
        if (registration.waiting) setUpdateWorker(registration.waiting)
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              setUpdateWorker(worker)
            }
          })
        })
        void registration.update()
      })
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      navigator.serviceWorker?.removeEventListener('controllerchange', handleControllerChange)
    }
  }, [])

  const install = useCallback(async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
  }, [installPrompt])

  const applyUpdate = useCallback(() => {
    if (!updateWorker) return
    refreshingRef.current = true
    updateWorker.postMessage({ type: 'SKIP_WAITING' })
  }, [updateWorker])

  return {
    online,
    canInstall: installPrompt !== null && !standalone,
    showIosHint: isIos && !iosHintDismissed,
    updateAvailable: updateWorker !== null,
    install,
    applyUpdate,
    dismissIosHint: () => setIosHintDismissed(true),
  }
}
