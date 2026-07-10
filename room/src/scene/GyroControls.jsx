import { useEffect, useRef } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// Standard DeviceOrientation -> camera quaternion (from three's old
// DeviceOrientationControls). Camera sits at a fixed interior spawn; turning
// or tilting the phone looks around the room.
const zee = new THREE.Vector3(0, 0, 1)
const euler = new THREE.Euler()
const q0 = new THREE.Quaternion()
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)) // -90deg about X
const DEG = Math.PI / 180

function applyDeviceOrientation(camera, alpha, beta, gamma, screenAngle) {
  euler.set(beta * DEG, alpha * DEG, -gamma * DEG, 'YXZ') // device -> world
  camera.quaternion.setFromEuler(euler)
  camera.quaternion.multiply(q1) // camera looks out the back of the device
  camera.quaternion.multiply(q0.setFromAxisAngle(zee, -screenAngle * DEG))
}

export function GyroControls({ enabled, position = [0, 1.55, 0.2] }) {
  const { camera } = useThree()
  const device = useRef({ alpha: 0, beta: 0, gamma: 0 })
  const screenAngle = useRef(0)

  useEffect(() => {
    if (!enabled) return
    const onOrient = (e) => {
      device.current = { alpha: e.alpha || 0, beta: e.beta || 0, gamma: e.gamma || 0 }
    }
    const onScreen = () => {
      const a = window.screen && window.screen.orientation && window.screen.orientation.angle
      screenAngle.current = typeof a === 'number' ? a : (window.orientation || 0)
    }
    onScreen()
    camera.position.set(position[0], position[1], position[2]) // fixed viewpoint
    window.addEventListener('deviceorientation', onOrient, true)
    window.addEventListener('orientationchange', onScreen)
    return () => {
      window.removeEventListener('deviceorientation', onOrient, true)
      window.removeEventListener('orientationchange', onScreen)
    }
  }, [enabled, camera, position])

  useFrame(() => {
    if (!enabled) return
    const d = device.current
    applyDeviceOrientation(camera, d.alpha, d.beta, d.gamma, screenAngle.current)
  })

  return null
}
