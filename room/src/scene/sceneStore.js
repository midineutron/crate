// Static registry of each CRT's world placement, populated by <Room> once the
// GLB loads and read by <CameraRig> to fly the camera in front of a screen.
// Keyed by screen id (e.g. 'L0_s'); value: { pos, camPos, target } as [x,y,z].
export const SCREEN_POSES = new Map()
