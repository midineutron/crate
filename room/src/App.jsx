import { Suspense, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing'
import * as THREE from 'three'
import { AudioProvider, useAudio } from './audio/audioContext'
import { Room } from './scene/Room'
import { GyroControls } from './scene/GyroControls'
import { CameraRig } from './scene/CameraRig'
import { Overlay } from './ui/Overlay'

// Red cluster lights that fake the emissive glow spilling into the room,
// pulsing with the low end. Positions are in three.js space (Blender Y-up).
const RED_LIGHTS = [
  [-0.3, 1.6, -1.7], [-2.8, 1.5, 1.0], [-2.8, 1.5, -1.0],
  [2.85, 1.4, -1.2], [-2.55, 1.0, 2.6],
]

function ReactiveLights() {
  const { engine } = useAudio()
  const group = useRef()
  useFrame(() => {
    const p = 1.6 + engine.bass * 9 + engine.level * 4.5
    if (group.current) for (const l of group.current.children) l.intensity = p
  })
  return (
    <group ref={group}>
      {RED_LIGHTS.map((pos, i) => (
        <pointLight key={i} position={pos} color="#ff2a1e" intensity={4} distance={5} decay={2} />
      ))}
    </group>
  )
}

function ReactiveBloom() {
  const { engine } = useAudio()
  const bloom = useRef()
  useFrame(() => {
    if (bloom.current) bloom.current.intensity = 0.7 + engine.level * 1.6 + engine.bass * 1.2
  })
  return (
    <EffectComposer>
      <Bloom
        ref={bloom}
        intensity={0.8}
        luminanceThreshold={0.35}
        luminanceSmoothing={0.9}
        mipmapBlur
      />
      <Vignette eskil={false} offset={0.25} darkness={0.85} />
    </EffectComposer>
  )
}

function SceneControls() {
  const { gyro, focused } = useAudio()
  const orbit = useRef()
  return (
    <>
      <OrbitControls
        ref={orbit}
        enabled={!gyro && !focused}
        target={[0, 1.5, 0]}
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={-0.4}
        minDistance={0.6}
        maxDistance={3.0}
        minPolarAngle={0.5}
        maxPolarAngle={Math.PI / 1.9}
      />
      <GyroControls enabled={gyro && !focused} />
      <CameraRig orbitRef={orbit} />
    </>
  )
}

export default function App() {
  return (
    <AudioProvider>
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [2.8, 1.7, 2.8], fov: 55, near: 0.1, far: 100 }}
        gl={{ antialias: true, toneMapping: THREE.AgXToneMapping, toneMappingExposure: 1.0 }}
      >
        <color attach="background" args={['#0a0607']} />
        <fogExp2 attach="fog" args={['#160a0b', 0.05]} />

        <ambientLight intensity={0.35} color="#333a4d" />
        <hemisphereLight args={['#3a4666', '#0c0606', 0.5]} />
        <directionalLight position={[0, 3, -4.5]} intensity={0.7} color="#aec2ff" />

        <Suspense fallback={null}>
          <Room />
        </Suspense>
        <ReactiveLights />
        <ReactiveBloom />

        <SceneControls />
      </Canvas>
      <Overlay />
    </AudioProvider>
  )
}
