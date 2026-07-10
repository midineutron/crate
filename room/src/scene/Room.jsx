import { useEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useAudio } from '../audio/audioContext'
import { NAME_TO_SCREEN, SCREEN_SET } from '../config/projects'
import { makeScreenCanvas, drawViz } from './ScreenViz'

// Resolve GLB under the app base (/room/ in production, / in dev-standalone).
const GLB = (import.meta.env.BASE_URL || '/') + 'room.glb'

export function Room() {
  const { scene } = useGLTF(GLB)
  const { engine, active, play } = useAudio()
  const { gl } = useThree()

  // Registry of screen surfaces -> { mesh, mat, bakedMap, canvas, tex }
  const screens = useRef(new Map())
  const hovered = useRef(null)

  // Prepare the GLB once: clone per-screen materials so each glows independently.
  useMemo(() => {
    scene.traverse((o) => {
      if (!o.isMesh) return
      o.castShadow = false
      o.receiveShadow = false
      if (o.name.startsWith('ScreenText_')) {
        const surface = o.name.replace('ScreenText_', '') // e.g. L0_s
        if (!SCREEN_SET.has(surface)) return
        o.material = o.material.clone()
        o.material.toneMapped = false
        o.material.emissive = new THREE.Color(0xffffff)
        o.material.emissiveIntensity = 1.0
        screens.current.set(surface, {
          mesh: o,
          mat: o.material,
          bakedMap: o.material.emissiveMap,
          canvas: null,
          tex: null,
        })
      }
    })
  }, [scene])

  const setActiveVisual = (surface) => {
    for (const [name, s] of screens.current) {
      if (name === surface) {
        if (!s.canvas) {
          s.canvas = makeScreenCanvas()
          s.tex = new THREE.CanvasTexture(s.canvas)
          s.tex.colorSpace = THREE.SRGBColorSpace
          s.tex.flipY = s.bakedMap ? s.bakedMap.flipY : true
        }
        s.mat.emissiveMap = s.tex
        s.mat.needsUpdate = true
      } else if (s.mat.emissiveMap !== s.bakedMap) {
        s.mat.emissiveMap = s.bakedMap
        s.mat.needsUpdate = true
      }
    }
  }

  useEffect(() => {
    setActiveVisual(active ? active.screen : null)
  }, [active])

  const onClick = (e) => {
    e.stopPropagation()
    const screen = NAME_TO_SCREEN[e.object.name]
    if (screen) play(screen)
  }
  const onOver = (e) => {
    e.stopPropagation()
    if (NAME_TO_SCREEN[e.object.name]) {
      hovered.current = e.object.name
      gl.domElement.style.cursor = 'pointer'
    }
  }
  const onOut = () => {
    hovered.current = null
    gl.domElement.style.cursor = 'default'
  }

  useFrame((state) => {
    engine.update()
    const lvl = engine.level, bass = engine.bass
    const t = state.clock.elapsedTime
    for (const [name, s] of screens.current) {
      const isActive = active && active.screen === name
      if (isActive) {
        drawViz(s.canvas, engine.freq, engine.time, active, t)
        s.tex.needsUpdate = true
        s.mat.emissiveIntensity = 1.5 + bass * 2.6
      } else {
        // idle: subtle room-wide pulse + slow flicker
        const flick = 0.92 + 0.08 * Math.sin(t * 6 + name.length)
        s.mat.emissiveIntensity = (0.85 + lvl * 0.7) * flick
      }
    }
  })

  return (
    <primitive
      object={scene}
      onClick={onClick}
      onPointerOver={onOver}
      onPointerOut={onOut}
    />
  )
}

useGLTF.preload(GLB)
