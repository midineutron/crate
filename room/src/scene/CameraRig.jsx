import { useEffect, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useAudio } from '../audio/audioContext'
import { SCREEN_POSES } from './sceneStore'

// Drives the camera. In 'orbit' mode it hands control to OrbitControls; when a
// computer is focused it disables orbit and lerps the camera in front of that
// screen, then lerps back home on unfocus. Owns orbit.enabled during
// transitions so React re-renders don't fight the animation.
export function CameraRig({ orbitRef }) {
  const { camera } = useThree()
  const { focused, gyro } = useAudio()

  const mode = useRef('orbit') // 'orbit' | 'in' | 'hold' | 'out'
  const prevFocused = useRef(undefined)
  const homePos = useRef(new THREE.Vector3(2.8, 1.7, 2.8))
  const homeTarget = useRef(new THREE.Vector3(0, 1.5, 0))
  const desiredPos = useRef(new THREE.Vector3())
  const desiredTarget = useRef(new THREE.Vector3())
  const curTarget = useRef(new THREE.Vector3(0, 1.5, 0))

  useEffect(() => {
    if (focused === prevFocused.current) return
    prevFocused.current = focused
    const orbit = orbitRef.current
    if (focused) {
      // Capture the room viewpoint to return to (only when coming from orbit).
      if (mode.current === 'orbit') {
        homePos.current.copy(camera.position)
        if (orbit) homeTarget.current.copy(orbit.target)
        curTarget.current.copy(orbit ? orbit.target : homeTarget.current)
      }
      const pose = SCREEN_POSES.get(focused)
      if (pose) {
        desiredPos.current.set(pose.camPos[0], pose.camPos[1], pose.camPos[2])
        desiredTarget.current.set(pose.target[0], pose.target[1], pose.target[2])
      }
      if (orbit) orbit.enabled = false
      mode.current = 'in'
    } else {
      desiredPos.current.copy(homePos.current)
      desiredTarget.current.copy(homeTarget.current)
      if (orbit) orbit.enabled = false
      mode.current = 'out'
    }
  }, [focused, camera, orbitRef])

  useFrame((_, delta) => {
    const orbit = orbitRef.current
    if (mode.current === 'orbit') {
      if (orbit) orbit.enabled = !gyro
      return
    }
    if (orbit) orbit.enabled = false // own it through the whole transition + hold
    if (mode.current === 'hold') {
      camera.lookAt(curTarget.current)
      return
    }
    const k = 1 - Math.pow(0.0009, Math.min(delta, 0.05))
    camera.position.lerp(desiredPos.current, k)
    curTarget.current.lerp(desiredTarget.current, k)
    camera.lookAt(curTarget.current)

    if (camera.position.distanceTo(desiredPos.current) < 0.015) {
      camera.position.copy(desiredPos.current)
      curTarget.current.copy(desiredTarget.current)
      camera.lookAt(curTarget.current)
      if (mode.current === 'out') {
        if (orbit) {
          orbit.target.copy(homeTarget.current)
          orbit.enabled = !gyro
          orbit.update()
        }
        mode.current = 'orbit'
      } else {
        mode.current = 'hold'
      }
    }
  })

  return null
}
