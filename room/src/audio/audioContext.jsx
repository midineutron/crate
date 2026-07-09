import { createContext, useContext, useMemo, useState, useRef, useCallback } from 'react'
import { AudioEngine } from './AudioEngine'
import { loadAssignments } from './catalog'

const Ctx = createContext(null)

export function AudioProvider({ children }) {
  const engine = useMemo(() => new AudioEngine(), [])
  const [active, setActive] = useState(null)
  const [source, setSource] = useState('demo') // 'catalog' | 'demo'
  const [entered, setEntered] = useState(
    () => typeof window !== 'undefined' && window.location.hash === '#enter'
  )
  const assignments = useRef({})

  const enter = useCallback(async () => {
    await engine.resume()
    const { map, source } = await loadAssignments()
    assignments.current = map
    setSource(source)
    setEntered(true)
  }, [engine])

  const play = useCallback(async (screen) => {
    const a = assignments.current[screen] || { title: screen, streamUrl: null, seed: 0 }
    try {
      if (a.streamUrl) await engine.playStream(a.streamUrl)
      else await engine.playDemo(a.seed || 0)
      engine.activeId = screen
      setActive({ screen, ...a })
    } catch (e) {
      console.error('audio play failed', e)
    }
  }, [engine])

  const stop = useCallback(() => {
    engine.stopSources()
    engine.activeId = null
    setActive(null)
  }, [engine])

  const value = useMemo(
    () => ({ engine, active, source, entered, enter, play, stop }),
    [engine, active, source, entered, enter, play, stop]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useAudio = () => useContext(Ctx)
