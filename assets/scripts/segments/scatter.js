import seedrandom from 'seedrandom'
import maxBy from 'lodash/maxBy'
import { images } from '../app/load_resources'
import { drawSegmentImage } from './view'
import { getSpriteDef } from './info'
import { TILE_SIZE, TILE_SIZE_ACTUAL } from './constants'

// Buffer area to avoid rendering sprites in.
// Will be applied to both edges of the segment.
const SEGMENT_PADDING = 2 // in feet

/**
 * Given a pool of objects, with defined widths, get the maximum width value
 * This number is used during rendering to adjust sprites for center alignment
 *
 * @param {Array} pool - of objects to draw from
 * @returns {Number} - maximum street width in feet
 */
function getSpriteMaxWidth (pool) {
  return maxBy(pool, 'width').width
}

/**
 * Given a pool of objects, and a few parameters, draw continuously from that
 * pool until it has fully populated the given segment width. Because it uses
 * segment width to know when to stop drawing, this function also does double
 * duty by setting distances between objects.
 *
 * This function is exported for unit testing only.
 *
 * @param {Array} pool - of objects to draw from
 * @param {Number} width - of segment to populate, in feet
 * @param {Number} randSeed - ensures a consistent sequence of objects across renders
 * @param {Number} minSpacing - minimum spacing between each object, in feet (controls density)
 * @param {Number} maxSpacing - maximt spacing between each object, in feet (controls density)
 * @param {Number} maxSpriteWidth - maximum sprite width in the pool (via `getSpriteMaxWidth()`)
 * @param {Number} spacingAdjustment - additional value to adjust spacing, in feet
 */
export function pickObjectsFromPool (
  pool,
  maxWidth,
  randSeed,
  minSpacing,
  maxSpacing,
  maxSpriteWidth,
  spacingAdjustment = 0
) {
  const randomGenerator = seedrandom(randSeed)

  const objects = []
  let runningWidth = 0
  let previousIndex = null
  let currentIndex = null
  let lastWidth = 0

  // Pick (draw) objects from the pool until we have at least one object, and
  // until we hit the maximum width given. SEGMENT_PADDING is used to so that
  // we don't render objects too closely to the edge of a segment.
  while (
    objects.length === 0 ||
    runningWidth < maxWidth - SEGMENT_PADDING * 2
  ) {
    let object

    // Special choosing logic only for larger pools.
    if (pool.length >= 4) {
      do {
        const index = Math.floor(randomGenerator() * pool.length)
        currentIndex = index

        // Clone the object
        object = Object.assign({}, pool[index])
      } while (
        // Don't pick the same object twice in a row, and avoid picking
        // certain objects as the first object in a list. This is because
        // some objects are "special" and look strange when on their own,
        // but can diversify when included in a list.
        currentIndex === previousIndex ||
        (objects.length === 0 && object.disallowFirst === true)
      )
    } else {
      const index = Math.floor(randomGenerator() * pool.length)
      currentIndex = index

      // Clone the object
      object = Object.assign({}, pool[index])
    }

    previousIndex = currentIndex
    object.left = runningWidth

    // Calculate the amount of space to allocate to this object,
    // creating space for placing the next object (if any).
    // First, take into account the object's defined sprite width.
    // Then add `minSpacing`, the minimum spacing between sprites.
    // Next, add a variable distance between sprites. This number
    // is randomly chosen between `minSpacing` and `maxSpacing.`
    // The `randomGenerator()` must be used to ensure that this random
    // number is consistent across renders.
    // Lastly, this is further tweaked by adding a `spacingAdjustment`
    // value, which can adjust overall density. In the case of people,
    // this value makes sprites slightly denser, to account for the
    // transparent space around each person sprite's defined width.
    lastWidth =
      object.width +
      minSpacing +
      randomGenerator() * (maxSpacing - minSpacing) +
      spacingAdjustment
    runningWidth += lastWidth

    objects.push(object)
  }

  // After exiting the loop, remove the space allocated for the next object,
  // by undoing the addition of `lastWidth` to `runningWidth`.
  // TODO: Refactor this behavior.
  const totalWidth = runningWidth - lastWidth

  // The left position of sprites are along the left edge.
  // This correction adjusts the actual left render position, based on the
  // width of the first and last sprites, to better balance centering the
  // sprites within the segment.
  const firstObjectCorrection = (maxSpriteWidth - objects[0].width) / 2
  const lastObjectCorrection =
    (maxSpriteWidth - objects[objects.length - 1].width) / 2

  let startLeft = (maxWidth - totalWidth) / 2
  if (objects.length === 1) {
    startLeft += firstObjectCorrection
  } else {
    startLeft += (firstObjectCorrection + lastObjectCorrection) / 2
  }

  return [objects, startLeft]
}

/**
 * General use case of rendering scattered sprites
 *
 * @param {Array} sprite - id of sprite to draw
 * @param {CanvasRenderingContext2D} ctx
 * @param {Number} width - width of segment to populate, in feet
 * @param {Number} offsetLeft
 * @param {Number} groundLevel - height at which to draw people
 * @param {Number} randSeed - ensures a consistent sequence of objects across renders
 * @param {Number} minSpacing - left spacing between each object, in feet (controls density)
 * @param {Number} maxSpacing - maximum right spacing between each object, in feet (controls density)
 * @param {Number} adjustment - further adjustment value
 * @param {Number} multiplier
 * @param {Number} dpi
 */
export function drawScatteredSprites (
  sprites,
  ctx,
  width,
  offsetLeft,
  groundLevel,
  randSeed,
  minSpacing,
  maxSpacing,
  adjustment = 0,
  multiplier,
  dpi
) {
  // Pool must be an array of objects. If an array of strings
  // is passed in, look up its sprite information from the string
  // id and convert to object.
  const pool = sprites.map((sprite) => {
    if (typeof sprite === 'string') {
      const svg = images.get(sprite)
      return {
        id: sprite,
        width: svg.width / TILE_SIZE_ACTUAL
      }
    }

    // Pass objects through as-is
    return sprite
  })

  const maxSpriteWidth = getSpriteMaxWidth(pool)
  const [objects, startLeft] = pickObjectsFromPool(
    pool,
    width,
    randSeed,
    minSpacing,
    maxSpacing,
    maxSpriteWidth,
    adjustment
  )

  for (const object of objects) {
    const id = object.id
    const sprite = getSpriteDef(id)
    const svg = images.get(id)

    const distanceFromGround =
      multiplier *
      TILE_SIZE *
      ((svg.height - (sprite.originY ?? object.originY ?? 0)) /
        TILE_SIZE_ACTUAL)

    drawSegmentImage(
      id,
      ctx,
      undefined,
      undefined,
      undefined,
      undefined,
      offsetLeft +
        (object.left -
          // Adjust offset according to the svg viewbox width
          svg.width / TILE_SIZE_ACTUAL / 2 -
          // Adjust according to sprite's defined "hitbox" width
          (maxSpriteWidth - object.width) / 2 +
          startLeft) *
          TILE_SIZE *
          multiplier,
      groundLevel - distanceFromGround,
      undefined,
      undefined,
      multiplier,
      dpi
    )
  }
}