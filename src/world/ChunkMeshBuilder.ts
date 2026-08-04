/**
 * ChunkMeshBuilder.ts — Face-culled merged geometry builder for the Minecraft Clone.
 *
 * This module is the critical rendering optimization layer. Instead of creating
 * one Mesh per block (which would result in millions of draw calls for a
 * 128×128×64 world), this builder merges all visible faces of a chunk into a
 * single BufferGeometry, reducing draw calls to one per chunk.
 *
 * ## Face Culling
 *
 * The builder only generates geometry for faces that are exposed to air or
 * water. Faces adjacent to opaque blocks are hidden and skipped, dramatically
 * reducing the vertex count. For example, a solid stone cube surrounded by
 * other stone blocks contributes zero faces, while a single grass block on
 * the surface contributes only its exposed faces.
 *
 * ## Texture Atlas
 *
 * All opaque block types share a single 4×2 texture atlas:
 *
 * ```
 * Row 0: [GRASS_TOP] [GRASS_SIDE] [DIRT]      [STONE]
 * Row 1: [SAND]      [WOOD]       [LEAVES]    [BEDROCK]
 * ```
 *
 * Each cell is 0.25 wide × 0.5 tall in UV space. The grass block uses
 * different cells for its top, side, and bottom faces to achieve the
 * classic Minecraft grass appearance.
 *
 * ## Separate Water Geometry
 *
 * Water blocks are rendered in a separate geometry with standard 0-1 UVs
 * and a single water texture. This allows the water material to use
 * transparency without affecting the opaque geometry.
 */
import * as THREE from 'three';
import { Chunk, CHUNK_SIZE } from './Chunk';
import { BlockType } from './World';
import { TextureGenerator } from '../textures/TextureGenerator';

/**
 * Enum representing the six faces of a cube.
 * Used to index face data and determine neighbor offsets.
 */
export enum FaceDirection {
  /** Positive X face (east) */
  POS_X = 0,
  /** Negative X face (west) */
  NEG_X = 1,
  /** Positive Y face (top) */
  POS_Y = 2,
  /** Negative Y face (bottom) */
  NEG_Y = 3,
  /** Positive Z face (south) */
  POS_Z = 4,
  /** Negative Z face (north) */
  NEG_Z = 5,
}

/**
 * Represents a single face of a unit cube.
 * The corners are offsets from the block's origin (0,0,0) to (1,1,1).
 * Corners are ordered counter-clockwise when viewed from outside the face,
 * ensuring correct triangle winding for Three.js.
 */
interface Face {
  /** The face's normal vector (unit length, pointing outward). */
  normal: [number, number, number];
  /** Four corner offsets in counter-clockwise order (viewed from outside). */
  corners: [number, number, number][];
}

/**
  * Face definitions for all six directions of a unit cube.
 * Each face has 4 corners forming a quad, ordered counter-clockwise (CCW)
 * when viewed from OUTSIDE the cube. This ensures correct triangle winding
 * for Three.js's default FrontSide culling — faces wound clockwise when
 * viewed from outside would be culled and invisible.
 *
 * The corner order determines both the triangle winding and the UV
 * assignment (corner i maps to UV i from getFaceUVs). Both must be in
 * the same CCW order for correct rendering.
 */
const FACES: Face[] = [
  // +X face (east) — normal points in +X direction
  // Corners are CCW when viewed from the +X side (looking toward -X).
  {
    normal: [1, 0, 0],
    corners: [
      [1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1],
    ],
  },
  // -X face (west) — normal points in -X direction
  // Corners are CCW when viewed from the -X side (looking toward +X).
  {
    normal: [-1, 0, 0],
    corners: [
      [0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0],
    ],
  },
  // +Y face (top) — normal points in +Y direction
  // Corners are CCW when viewed from the +Y side (looking down from above).
  {
    normal: [0, 1, 0],
    corners: [
      [1, 1, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1],
    ],
  },
    // -Y face (bottom) — normal points in -Y direction
  // Corners are CCW when viewed from the -Y side (looking up from below).
  {
    normal: [0, -1, 0],
    corners: [
      [1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 0, 0],
    ],
  },
  // +Z face (south) — normal points in +Z direction
  {
    normal: [0, 0, 1],
    corners: [
      [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
    ],
  },
  // -Z face (north) — normal points in -Z direction
  {
    normal: [0, 0, -1],
    corners: [
      [1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0],
    ],
  },
];

/**
 * Neighbor offsets for each face direction.
 * Used to compute the adjacent block's world coordinates for face culling.
 */
const FACE_OFFSETS: [number, number, number][] = [
  [1, 0, 0],   // POS_X
  [-1, 0, 0],  // NEG_X
  [0, 1, 0],   // POS_Y
  [0, -1, 0],  // NEG_Y
  [0, 0, 1],   // POS_Z
  [0, 0, -1],  // NEG_Z
];



/**
  * ChunkMeshBuilder — Static utility class for building merged chunk geometries.
 *
 * This class provides three geometry builders:
 * - `buildChunkGeometry`: builds geometry for opaque blocks (grass, dirt,
 *   stone, sand, wood, leaves, bedrock) using the 4×2 texture atlas.
 * - `buildWaterGeometry`: builds geometry for water blocks using a single
 *   water texture with standard 0-1 UVs.
 * - `buildGlassGeometry`: builds geometry for glass blocks using a single
 *   glass texture with standard 0-1 UVs. Glass is rendered separately
 *   with a transparent material.
 *
 * All methods perform face culling to only generate visible faces,
 * dramatically reducing vertex counts and draw calls.
 */
export class ChunkMeshBuilder {
  /**
      * Builds a merged BufferGeometry for all opaque blocks in the chunk.
   *
   * The geometry contains only visible faces — faces adjacent to opaque
   * blocks are culled. All opaque block types are merged into a single
   * geometry with UVs referencing the shared 4×2 texture atlas.
   *
   * **Coordinate System**: Vertices are generated in LOCAL chunk coordinates
   * (0-15 on each axis). The mesh transform (positioned at the chunk's world
   * origin in ChunkMesh.ts) handles placement in world space. Neighbor checks
   * use WORLD coordinates via the getBlockAt callback.
   *
   * @param chunk - The chunk to build geometry for.
   * @param getBlockAt - Callback to retrieve block types at world coordinates.
   *                     Used to check neighbors outside the current chunk.
   * @returns A BufferGeometry containing all visible opaque faces.
   */
  public static buildChunkGeometry(
    chunk: Chunk,
    getBlockAt: (worldX: number, worldY: number, worldZ: number) => BlockType
  ): THREE.BufferGeometry {
    // Dynamic arrays for vertex data (grow as faces are added)
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    // Compute the chunk's world origin
    const originX = chunk.chunkX * CHUNK_SIZE;
    const originY = chunk.chunkY * CHUNK_SIZE;
    const originZ = chunk.chunkZ * CHUNK_SIZE;

    // Track the current vertex index for index building
    let vertexIndex = 0;

    // Iterate over all blocks in the chunk
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let y = 0; y < CHUNK_SIZE; y++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          // Get the block type at this local position
          const blockType = chunk.getBlock(x, y, z);

          // Skip air blocks — they have no visible faces
          if (blockType === BlockType.AIR) {
            continue;
          }

                              // Skip water blocks — they are handled by buildWaterGeometry
          if (blockType === BlockType.WATER) {
            continue;
          }

          // Skip glass blocks — they are handled by buildGlassGeometry
          if (blockType === BlockType.GLASS) {
            continue;
          }

          // Compute world coordinates for this block (used for neighbor checks)
          const worldX = originX + x;
          const worldY = originY + y;
          const worldZ = originZ + z;

          // Local coordinates for vertex positions.
          // Vertices are in LOCAL chunk coordinates (0-15).
          // The mesh transform (positioned at the chunk's world origin)
          // handles placement in world space.
          const xPos = x;
          const yPos = y;
          const zPos = z;

          // Check each of the 6 faces for visibility
          for (let faceIndex = 0; faceIndex < 6; faceIndex++) {
            // Compute the neighbor's world coordinates
            const neighborX = worldX + FACE_OFFSETS[faceIndex][0];
            const neighborY = worldY + FACE_OFFSETS[faceIndex][1];
            const neighborZ = worldZ + FACE_OFFSETS[faceIndex][2];

            // Get the neighbor block type
            const neighborType = getBlockAt(neighborX, neighborY, neighborZ);

            // Face is visible if the neighbor is AIR or WATER
            // (water is transparent, so faces adjacent to water are visible)
            const isVisible =
              neighborType === BlockType.AIR ||
              neighborType === BlockType.WATER;

            // Skip hidden faces (face culling)
            if (!isVisible) {
              continue;
            }

            // Get the face definition
            const face = FACES[faceIndex];

                        // Compute the variant index for this block position.
            // The variant is deterministic per block position, so adjacent
            // blocks show visible texture variation while remaining stable
            // across frames and sessions.
            const variant = TextureGenerator.getVariantIndex(worldX, worldY, worldZ);

            // Get the atlas cell for this block type, face direction, and variant.
            // GRASS uses different cells for top vs side/bottom faces.
            const cell = TextureGenerator.getAtlasCellForBlock(blockType, faceIndex, variant);

            // Get the UV coordinates for this atlas cell.
            const faceUVs = TextureGenerator.getFaceUVs(cell[0], cell[1]);

            // Add the 4 vertices for this face
            for (let cornerIndex = 0; cornerIndex < 4; cornerIndex++) {
              const corner = face.corners[cornerIndex];

              // Position: local block position + corner offset
              // Vertices are in LOCAL chunk coordinates.
              // The mesh transform (positioned at the chunk's world origin)
              // handles world placement.
              positions.push(xPos + corner[0]);
              positions.push(yPos + corner[1]);
              positions.push(zPos + corner[2]);

              // Normal: face normal (same for all 4 corners)
              normals.push(face.normal[0]);
              normals.push(face.normal[1]);
              normals.push(face.normal[2]);

              // UV: from the atlas cell
              uvs.push(faceUVs[cornerIndex][0]);
              uvs.push(faceUVs[cornerIndex][1]);
            }

            // Add the 6 indices for the two triangles forming the quad
            // Triangle 1: (0, 1, 2)
            indices.push(vertexIndex);
            indices.push(vertexIndex + 1);
            indices.push(vertexIndex + 2);
            // Triangle 2: (0, 2, 3)
            indices.push(vertexIndex);
            indices.push(vertexIndex + 2);
            indices.push(vertexIndex + 3);

            // Advance the vertex index by 4 (one quad)
            vertexIndex += 4;
          }
        }
      }
    }

    // Create the BufferGeometry with the collected vertex data
    const geometry = new THREE.BufferGeometry();

    // Set position attribute
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    );

    // Set normal attribute
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(normals, 3)
    );

    // Set UV attribute
    geometry.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(uvs, 2)
    );

    // Set index
    geometry.setIndex(indices);

    return geometry;
  }

      /**
      * Builds a merged BufferGeometry for all water blocks in the chunk.
   *
   * Water faces are only visible when adjacent to AIR (the water surface
   * exposed to the open sky). Faces adjacent to solid terrain blocks are
   * hidden because the terrain block's face is rendered instead — this
   * prevents z-fighting/overlap at water-terrain interfaces. Faces between
   * adjacent water blocks are also hidden (internal water-water interfaces).
   * The geometry uses standard 0-1 UVs with a single water texture.
   *
   * **Coordinate System**: Vertices are generated in LOCAL chunk coordinates
   * (0-15 on each axis). The mesh transform (positioned at the chunk's world
   * origin in ChunkMesh.ts) handles placement in world space. Neighbor checks
   * use WORLD coordinates via the getBlockAt callback.
   *
   * @param chunk - The chunk to build water geometry for.
   * @param getBlockAt - Callback to retrieve block types at world coordinates.
   *                     Used to check neighbors outside the current chunk.
   * @returns A BufferGeometry containing all visible water faces.
   */
  public static buildWaterGeometry(
    chunk: Chunk,
    getBlockAt: (worldX: number, worldY: number, worldZ: number) => BlockType
  ): THREE.BufferGeometry {
    // Dynamic arrays for vertex data
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    // Compute the chunk's world origin
    const originX = chunk.chunkX * CHUNK_SIZE;
    const originY = chunk.chunkY * CHUNK_SIZE;
    const originZ = chunk.chunkZ * CHUNK_SIZE;

    // Track the current vertex index
    let vertexIndex = 0;

    // Iterate over all blocks in the chunk
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let y = 0; y < CHUNK_SIZE; y++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
                    // Only process water blocks
          if (chunk.getBlock(x, y, z) !== BlockType.WATER) {
            continue;
          }

          // Compute world coordinates for this block (used for neighbor checks)
          const worldX = originX + x;
          const worldY = originY + y;
          const worldZ = originZ + z;

          // Local coordinates for vertex positions.
          // Vertices are in LOCAL chunk coordinates (0-15).
          // The mesh transform (positioned at the chunk's world origin)
          // handles placement in world space.
          const xPos = x;
          const yPos = y;
          const zPos = z;

          // Check each of the 6 faces for visibility
          for (let faceIndex = 0; faceIndex < 6; faceIndex++) {
            // Compute the neighbor's world coordinates
            const neighborX = worldX + FACE_OFFSETS[faceIndex][0];
            const neighborY = worldY + FACE_OFFSETS[faceIndex][1];
            const neighborZ = worldZ + FACE_OFFSETS[faceIndex][2];

            // Get the neighbor block type
            const neighborType = getBlockAt(neighborX, neighborY, neighborZ);

                                    // Water faces are only visible when adjacent to AIR (the water surface
            // exposed to the open sky). Faces adjacent to solid terrain blocks are
            // hidden because the terrain block's face is rendered instead — this
            // prevents z-fighting/overlap at water-terrain interfaces. Faces between
            // adjacent water blocks are also hidden (internal water-water interfaces).
            const isVisible = neighborType === BlockType.AIR;

            // Skip hidden faces
            if (!isVisible) {
              continue;
            }

            // Get the face definition
            const face = FACES[faceIndex];

                        // Standard 0-1 UVs for water (single texture, no atlas)
            const faceUVs: [number, number][] = [
              [0, 0], [1, 0], [1, 1], [0, 1],
            ];

            // Add the 4 vertices for this face
            for (let cornerIndex = 0; cornerIndex < 4; cornerIndex++) {
              const corner = face.corners[cornerIndex];

              // Position: local block position + corner offset
              // Vertices are in LOCAL chunk coordinates.
              // The mesh transform (positioned at the chunk's world origin)
              // handles world placement.
              positions.push(xPos + corner[0]);
              positions.push(yPos + corner[1]);
              positions.push(zPos + corner[2]);

              // Normal: face normal
              normals.push(face.normal[0]);
              normals.push(face.normal[1]);
              normals.push(face.normal[2]);

              // UV: standard 0-1
              uvs.push(faceUVs[cornerIndex][0]);
              uvs.push(faceUVs[cornerIndex][1]);
            }

            // Add the 6 indices for the two triangles
            indices.push(vertexIndex);
            indices.push(vertexIndex + 1);
            indices.push(vertexIndex + 2);
            indices.push(vertexIndex);
            indices.push(vertexIndex + 2);
            indices.push(vertexIndex + 3);

            // Advance the vertex index
            vertexIndex += 4;
          }
        }
      }
    }

    // Create the BufferGeometry
    const geometry = new THREE.BufferGeometry();

    // Set position attribute
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    );

    // Set normal attribute
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(normals, 3)
    );

    // Set UV attribute
    geometry.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(uvs, 2)
    );

        // Set index
    geometry.setIndex(indices);

    return geometry;
  }

  /**
   * Builds a merged BufferGeometry for all glass blocks in the chunk.
   *
   * Glass faces are visible when adjacent to AIR, WATER, or GLASS — all
   * transparent block types. This means:
   * - A glass face exposed to open air is rendered (you can see through it).
   * - A glass face adjacent to water is rendered (both are transparent).
   * - A glass face adjacent to another glass block is rendered (both are
   *   transparent, so the shared face is visible through either side).
   * - A glass face adjacent to an opaque block (grass, dirt, stone, sand,
   *   wood, leaves, bedrock) is hidden — the opaque block's face is
   *   rendered instead, preventing z-fighting/overlap at the interface.
   *
   * The geometry uses standard 0-1 UVs with a single glass texture,
   * allowing the glass material to use transparency without affecting
   * the opaque geometry.
   *
   * **Coordinate System**: Vertices are generated in LOCAL chunk coordinates
   * (0-15 on each axis). The mesh transform (positioned at the chunk's world
   * origin in ChunkMesh.ts) handles placement in world space. Neighbor checks
   * use WORLD coordinates via the getBlockAt callback.
   *
   * @param chunk - The chunk to build glass geometry for.
   * @param getBlockAt - Callback to retrieve block types at world coordinates.
   *                     Used to check neighbors outside the current chunk.
   * @returns A BufferGeometry containing all visible glass faces.
   */
  public static buildGlassGeometry(
    chunk: Chunk,
    getBlockAt: (worldX: number, worldY: number, worldZ: number) => BlockType
  ): THREE.BufferGeometry {
    // Dynamic arrays for vertex data
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    // Compute the chunk's world origin
    const originX = chunk.chunkX * CHUNK_SIZE;
    const originY = chunk.chunkY * CHUNK_SIZE;
    const originZ = chunk.chunkZ * CHUNK_SIZE;

    // Track the current vertex index
    let vertexIndex = 0;

    // Iterate over all blocks in the chunk
    for (let x = 0; x < CHUNK_SIZE; x++) {
      for (let y = 0; y < CHUNK_SIZE; y++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
          // Only process glass blocks
          if (chunk.getBlock(x, y, z) !== BlockType.GLASS) {
            continue;
          }

          // Compute world coordinates for this block (used for neighbor checks)
          const worldX = originX + x;
          const worldY = originY + y;
          const worldZ = originZ + z;

          // Local coordinates for vertex positions.
          // Vertices are in LOCAL chunk coordinates (0-15).
          // The mesh transform (positioned at the chunk's world origin)
          // handles placement in world space.
          const xPos = x;
          const yPos = y;
          const zPos = z;

          // Check each of the 6 faces for visibility
          for (let faceIndex = 0; faceIndex < 6; faceIndex++) {
            // Compute the neighbor's world coordinates
            const neighborX = worldX + FACE_OFFSETS[faceIndex][0];
            const neighborY = worldY + FACE_OFFSETS[faceIndex][1];
            const neighborZ = worldZ + FACE_OFFSETS[faceIndex][2];

            // Get the neighbor block type
            const neighborType = getBlockAt(neighborX, neighborY, neighborZ);

            // Glass faces are visible when adjacent to AIR, WATER, or GLASS
            // (all transparent block types). Faces adjacent to opaque blocks
            // are hidden because the opaque block's face is rendered instead
            // — this prevents z-fighting/overlap at glass-terrain interfaces.
            const isVisible =
              neighborType === BlockType.AIR ||
              neighborType === BlockType.WATER ||
              neighborType === BlockType.GLASS;

            // Skip hidden faces
            if (!isVisible) {
              continue;
            }

            // Get the face definition
            const face = FACES[faceIndex];

            // Standard 0-1 UVs for glass (single texture, no atlas)
            const faceUVs: [number, number][] = [
              [0, 0], [1, 0], [1, 1], [0, 1],
            ];

            // Add the 4 vertices for this face
            for (let cornerIndex = 0; cornerIndex < 4; cornerIndex++) {
              const corner = face.corners[cornerIndex];

              // Position: local block position + corner offset
              // Vertices are in LOCAL chunk coordinates.
              // The mesh transform (positioned at the chunk's world origin)
              // handles world placement.
              positions.push(xPos + corner[0]);
              positions.push(yPos + corner[1]);
              positions.push(zPos + corner[2]);

              // Normal: face normal
              normals.push(face.normal[0]);
              normals.push(face.normal[1]);
              normals.push(face.normal[2]);

              // UV: standard 0-1
              uvs.push(faceUVs[cornerIndex][0]);
              uvs.push(faceUVs[cornerIndex][1]);
            }

            // Add the 6 indices for the two triangles
            indices.push(vertexIndex);
            indices.push(vertexIndex + 1);
            indices.push(vertexIndex + 2);
            indices.push(vertexIndex);
            indices.push(vertexIndex + 2);
            indices.push(vertexIndex + 3);

            // Advance the vertex index
            vertexIndex += 4;
          }
        }
      }
    }

    // Create the BufferGeometry
    const geometry = new THREE.BufferGeometry();

    // Set position attribute
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    );

    // Set normal attribute
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(normals, 3)
    );

    // Set UV attribute
    geometry.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(uvs, 2)
    );

    // Set index
    geometry.setIndex(indices);

    return geometry;
  }

  

      /**
   * Computes the 4 UV coordinates for an atlas cell.
   *
   * This is a thin wrapper that delegates to TextureGenerator.getFaceUVs
   * for backward compatibility. The atlas is now a 12×2 grid (managed by
   * TextureGenerator) where each cell is 1/12 wide × 1/2 tall.
   *
   * @param cellX - The cell's column index (0-11).
   * @param cellY - The cell's row index (0-1).
   * @returns An array of 4 UV coordinate pairs.
   */
  public static getFaceUVs(cellX: number, cellY: number): [number, number][] {
    return TextureGenerator.getFaceUVs(cellX, cellY);
  }
}