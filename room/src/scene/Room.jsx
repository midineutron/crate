import { useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useAudio } from '../audio/audioContext'
import { NAME_TO_SCREEN, SCREEN_SET, SCREEN_COLORS } from '../config/projects'
import { makeScreenCanvas, drawViz, drawIdle } from './ScreenViz'
import { SCREEN_POSES } from './sceneStore'
import { shades, RED } from '../palette'

// Resolve GLB under the app base (/room/ in production, / in dev-standalone).
const GLB = (import.meta.env.BASE_URL || '/') + 'room.glb'

const VFOV = 55 * Math.PI / 180 // must match the <Canvas> camera fov
const INTERIOR = new THREE.Vector3(0, 1.4, 0)

// Compute the world placement of a screen surface and the camera pose that
// frames it head-on, stashing it in SCREEN_POSES for <CameraRig>.
function registerPose(surface, mesh) {
  const box = new THREE.Box3().setFromObject(mesh)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())

  // World-space front normal from the plane's geometry normal.
  const ln = new THREE.Vector3(0, 0, 1)
  const na = mesh.geometry.attributes.normal
  if (na) ln.set(na.getX(0), na.getY(0), na.getZ(0))
  const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)
  const wn = ln.applyMatrix3(nm).normalize()
  if (wn.dot(INTERIOR.clone().sub(center)) < 0) wn.negate() // face into the room

  const radius = 0.5 * Math.max(size.x, size.y, size.z)
  let dist = (radius / Math.tan(VFOV / 2)) * 1.35
  dist = Math.min(Math.max(dist, 0.32), 1.5)
  const camPos = center.clone().add(wn.multiplyScalar(dist))
  camPos.y = Math.max(camPos.y, 0.9) // never dip through the floor

  SCREEN_POSES.set(surface, {
    pos: [center.x, center.y, center.z],
    camPos: [camPos.x, camPos.y, camPos.z],
    target: [center.x, center.y, center.z],
  })
}

// Baked-red materials that should follow the whole-room accent (window LEDs,
// tower/computer LEDs, lamp glow, floor light strip, exit sign).
const ROOM_ACCENT_MATS = new Set(['SH_LED', 'SH_RedLine', 'SH_Exit'])

export function Room() {
  const { scene } = useGLTF(GLB)
  const { engine, byScreen, active, activeProject, activeTrack, focus, accent } = useAudio()
  const { gl } = useThree()

  // Registry of screen surfaces -> { mesh, mat, canvas, tex, order, pal }
  const screens = useRef(new Map())
  const glass = useRef(new Map())     // surface id -> the *_s screen-glass material
  const accentMats = useRef([])       // shared room materials lerped to the accent
  const frame = useRef(0)

  // Live THREE.Color target for the room accent.
  const accentColor = useMemo(() => new THREE.Color(accent), [accent])

  // Prepare the GLB once: clone per-screen materials, give each its own live
  // canvas texture, recolour the screen glass + room accents, and register the
  // camera pose.
  useMemo(() => {
    scene.updateMatrixWorld(true)
    let order = 0
    const seenAccent = new Set()
    scene.traverse((o) => {
      if (!o.isMesh) return
      o.castShadow = false
      o.receiveShadow = false
      const matName = o.material && o.material.name

      // Shared room-accent materials: keep one reference each, mutate live.
      if (matName && ROOM_ACCENT_MATS.has(matName) && !seenAccent.has(matName)) {
        seenAccent.add(matName)
        accentMats.current.push(o.material)
      }

      // Screen glass (*_s, material SH_Screen): recolour its red emissive to the
      // screen's own TV colour so every facing matches, not just the front.
      if (SCREEN_SET.has(o.name)) {
        o.material = o.material.clone()
        o.material.emissive = new THREE.Color(SCREEN_COLORS[o.name] || RED)
        o.material.emissiveIntensity = 1.6
        glass.current.set(o.name, o.material)
      }

      if (o.name.startsWith('ScreenText_')) {
        const surface = o.name.replace('ScreenText_', '') // e.g. L0_s
        if (!SCREEN_SET.has(surface)) return
        o.material = o.material.clone()
        o.material.toneMapped = false
        o.material.emissive = new THREE.Color(0xffffff)
        o.material.emissiveIntensity = 1.0
        const canvas = makeScreenCanvas()
        const tex = new THREE.CanvasTexture(canvas)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.flipY = o.material.emissiveMap ? o.material.emissiveMap.flipY : true
        o.material.emissiveMap = tex
        o.material.needsUpdate = true
        const pal = shades(SCREEN_COLORS[surface] || RED)
        screens.current.set(surface, { mesh: o, mat: o.material, canvas, tex, order: order++, pal })
        registerPose(surface, o)
      }
    })
  }, [scene])

  const onClick = (e) => {
    e.stopPropagation()
    const screen = NAME_TO_SCREEN[e.object.name]
    if (screen && byScreen[screen]) focus(screen) // only lit computers are interactive
  }
  const onOver = (e) => {
    e.stopPropagation()
    const screen = NAME_TO_SCREEN[e.object.name]
    if (screen && byScreen[screen]) gl.domElement.style.cursor = 'pointer'
  }
  const onOut = () => { gl.domElement.style.cursor = 'default' }

  useFrame((state) => {
    engine.update()
    const lvl = engine.level, bass = engine.bass
    const t = state.clock.elapsedTime
    const f = frame.current++
    const activeScreen = active ? active.screen : null
    const info = activeTrack
      ? { name: activeTrack.name, sub: (activeProject ? activeProject.name : '') }
      : null

    for (const [name, s] of screens.current) {
      const project = byScreen[name] || null
      const g = glass.current.get(name)
      if (name === activeScreen) {
        drawViz(s.canvas, engine.freq, engine.time, info, t, s.pal)
        s.tex.needsUpdate = true
        s.mat.emissiveIntensity = 1.5 + bass * 2.6
        if (g) g.emissiveIntensity = 2.0 + bass * 1.8
      } else {
        // Idle screens redraw at ~10fps, staggered so the cost is spread out.
        if ((f + s.order) % 6 === 0) {
          drawIdle(s.canvas, project, t, lvl, s.pal)
          s.tex.needsUpdate = true
        }
        const flick = 0.92 + 0.08 * Math.sin(t * 6 + name.length)
        s.mat.emissiveIntensity = (project ? 0.85 + lvl * 0.6 : 0.5) * flick
        if (g) g.emissiveIntensity = (project ? 1.5 : 0.6) * flick
      }
    }

    // Room-wide baked accents (windows, LEDs, lamp, floor strip) ease their
    // colour to the current accent, keeping their authored brightness.
    for (const m of accentMats.current) m.emissive.lerp(accentColor, 0.08)
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
