/**
 * Textures drawn on a 2D canvas, kept safe.
 *
 * A canvas texture points at the canvas element, and iOS empties the canvases
 * of a backgrounded tab to save memory: come back to the game and anything
 * drawn on one (the turf, the ball) uploads as black. So the pixels are copied
 * out into a DataTexture that lives in JavaScript memory, where the OS cannot
 * reach them.
 */

import * as THREE from 'three';

export function pixelTexture(canvas, { colorSpace = THREE.NoColorSpace, wrap = false } = {}) {
  const { width, height } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const texture = new THREE.DataTexture(new Uint8Array(data), width, height, THREE.RGBAFormat);
  texture.flipY = true; // the same way up as a CanvasTexture
  texture.colorSpace = colorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  if (wrap) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}
