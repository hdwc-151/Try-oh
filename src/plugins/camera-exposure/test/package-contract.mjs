import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkCameraExposure } from '@hdwc-151/camera-exposure'

function grayFrame(levels) {
  return Uint8ClampedArray.from(levels.flatMap(value => [value, value, value, 255]))
}

test('only warns when more than 70 percent of the complete pixels are clipped', () => {
  const cases = [[0, 'dark'], [255, 'bright']]
  for (const [value, expected] of cases) {
    assert.equal(checkCameraExposure(grayFrame([...Array(7).fill(value), 95, 95, 95])), 'balanced')
    assert.equal(checkCameraExposure(grayFrame([...Array(8).fill(value), 95, 95])), expected)
  }
})

test('reads weighted RGB luminance and ignores alpha', () => {
  assert.equal(checkCameraExposure(Uint8ClampedArray.of(0, 0, 200, 255)), 'dark')
  assert.equal(checkCameraExposure(Uint8ClampedArray.of(0, 200, 0, 0)), 'balanced')
  assert.equal(checkCameraExposure(Uint8ClampedArray.of(255, 255, 255, 0)), 'bright')
})

test('empty samples and incomplete RGBA tails keep the existing result', () => {
  assert.equal(checkCameraExposure(new Uint8ClampedArray()), 'balanced')
  assert.equal(checkCameraExposure(Uint8ClampedArray.of(0, 0, 0)), 'balanced')
  assert.equal(checkCameraExposure(Uint8ClampedArray.of(255, 255, 255, 255, 0, 0)), 'bright')
})
