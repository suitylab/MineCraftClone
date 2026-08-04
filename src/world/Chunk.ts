/**
 * Chunk.ts — 16×16×16 voxel chunk data structure.
 *
 * A chunk is the fundamental unit of world storage in the Minecraft clone.
 * Each chunk stores 4096 blocks (16 × 16 × 16) in a flat Uint8Array for
 * memory efficiency and cache-friendly sequential access.
 *
 * The chunk is a pure data container — it has no dependency on Three.js
 * and does not handle rendering. Rendering is performed separately by
 * ChunkMeshBuilder, which reads block data from this structure.
 *
 * Coordinate system:
 * - Local coordinates: (x, y, z) where each axis ranges [0, 15]
 * - World coordinates: absolute position in the voxel world
 * - Chunk coordinates: identify which chunk a block belongs to
 *
 * Index formula: index = (x * 16 + z) * 16 + y
 * This groups blocks by vertical column (x, z fixed, y varying), which
 * is optimal for terrain generation and heightmap queries.
 */
import { BlockType } from './World';

/** The size of a chunk along each axis (x, y, z) in blocks. */
export const CHUNK_SIZE = 16;

/** Total number of blocks in a chunk: 16 × 16 × 16 = 4096. */
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;

/**
 * Chunk — a 16×16×16 voxel data container.
 *
 * Stores block types in a flat Uint8Array for memory efficiency.
 * Each byte stores the numeric value of a BlockType enum member.
 *
 * The chunk is self-contained and does not depend on any rendering
 * library. It provides methods for reading, writing, and querying
 * block data at local coordinates, as well as converting between
 * local and world coordinate spaces.
 */
export class Chunk {
  /** X coordinate of this chunk in chunk-grid space. */
  private readonly _chunkX: number;

  /** Y coordinate of this chunk in chunk-grid space (vertical). */
  private readonly _chunkY: number;

  /** Z coordinate of this chunk in chunk-grid space. */
  private readonly _chunkZ: number;

  /** Flat array of block type values. Length is always CHUNK_VOLUME. */
  private readonly _blocks: Uint8Array;

  /**
   * Creates a new empty chunk at the given chunk coordinates.
   *
   * All blocks are initialized to AIR (BlockType.AIR = 0).
   *
   * @param chunkX - X coordinate in chunk-grid space.
   * @param chunkY - Y coordinate in chunk-grid space (vertical).
   * @param chunkZ - Z coordinate in chunk-grid space.
   */
  constructor(chunkX: number, chunkY: number, chunkZ: number) {
    this._chunkX = chunkX;
    this._chunkY = chunkY;
    this._chunkZ = chunkZ;

    // Allocate the flat block array and initialize all blocks to AIR.
    // Uint8Array is zero-initialized by default, and AIR = 0, so no
    // explicit fill is needed.
    this._blocks = new Uint8Array(CHUNK_VOLUME);
  }

  /**
   * Gets the X coordinate of this chunk in chunk-grid space.
   */
  public get chunkX(): number {
    return this._chunkX;
  }

  /**
   * Gets the Y coordinate of this chunk in chunk-grid space (vertical).
   */
  public get chunkY(): number {
    return this._chunkY;
  }

  /**
   * Gets the Z coordinate of this chunk in chunk-grid space.
   */
  public get chunkZ(): number {
    return this._chunkZ;
  }

  /**
   * Computes the flat array index for the given local coordinates.
   *
   * The index formula groups blocks by vertical column:
   *   index = (x * 16 + z) * 16 + y
   *
   * This layout keeps all blocks in a vertical column contiguous in
   * memory, which is cache-friendly for heightmap-based algorithms.
   *
   * @param x - Local X coordinate in range [0, 15].
   * @param y - Local Y coordinate in range [0, 15] (vertical).
   * @param z - Local Z coordinate in range [0, 15].
   * @returns The flat array index, or -1 if any coordinate is out of bounds.
   */
  public getBlockIndex(x: number, y: number, z: number): number {
    // Validate bounds to prevent out-of-range array access.
    if (
      x < 0 || x >= CHUNK_SIZE ||
      y < 0 || y >= CHUNK_SIZE ||
      z < 0 || z >= CHUNK_SIZE
    ) {
      return -1;
    }

    // Compute the flat index: (x * 16 + z) * 16 + y
    return (x * CHUNK_SIZE + z) * CHUNK_SIZE + y;
  }

  /**
   * Gets the block type at the given local coordinates.
   *
   * If any coordinate is out of bounds, returns AIR. This makes the
   * method safe to call with arbitrary coordinates without requiring
   * explicit bounds checking by the caller.
   *
   * @param x - Local X coordinate in range [0, 15].
   * @param y - Local Y coordinate in range [0, 15] (vertical).
   * @param z - Local Z coordinate in range [0, 15].
   * @returns The BlockType at the given position, or AIR if out of bounds.
   */
  public getBlock(x: number, y: number, z: number): BlockType {
    const index = this.getBlockIndex(x, y, z);

    // Out-of-bounds reads return AIR (empty space).
    if (index === -1) {
      return BlockType.AIR;
    }

    // Cast the numeric value to the BlockType enum.
    return this._blocks[index] as BlockType;
  }

  /**
   * Sets the block type at the given local coordinates.
   *
   * If any coordinate is out of bounds, the operation is silently
   * ignored (no-op). This prevents accidental corruption of the
   * chunk data from invalid writes.
   *
   * @param x - Local X coordinate in range [0, 15].
   * @param y - Local Y coordinate in range [0, 15] (vertical).
   * @param z - Local Z coordinate in range [0, 15].
   * @param type - The BlockType to set at the given position.
   */
  public setBlock(x: number, y: number, z: number, type: BlockType): void {
    const index = this.getBlockIndex(x, y, z);

    // Ignore out-of-bounds writes.
    if (index === -1) {
      return;
    }

    // Store the numeric value of the enum member.
    this._blocks[index] = type as number;
  }

  /**
   * Checks whether the block at the given local coordinates is AIR.
   *
   * Out-of-bounds positions are considered AIR (empty space), which
   * is consistent with getBlock() behavior.
   *
   * @param x - Local X coordinate in range [0, 15].
   * @param y - Local Y coordinate in range [0, 15] (vertical).
   * @param z - Local Z coordinate in range [0, 15].
   * @returns True if the block is AIR or out of bounds, false otherwise.
   */
  public isAir(x: number, y: number, z: number): boolean {
    return this.getBlock(x, y, z) === BlockType.AIR;
  }

  /**
   * Fills the entire chunk with the given block type.
   *
   * This is an O(n) bulk operation that overwrites all 4096 blocks.
   * It is idempotent — calling it multiple times with the same type
   * produces the same result.
   *
   * @param type - The BlockType to fill the entire chunk with.
   */
  public fill(type: BlockType): void {
    // Uint8Array.fill() is highly optimized for bulk writes.
    this._blocks.fill(type as number);
  }

  /**
   * Converts a local X coordinate to a world X coordinate.
   *
   * @param x - Local X coordinate in range [0, 15].
   * @returns The corresponding world X coordinate.
   */
  public getWorldX(x: number): number {
    return this._chunkX * CHUNK_SIZE + x;
  }

  /**
   * Converts a local Y coordinate to a world Y coordinate.
   *
   * @param y - Local Y coordinate in range [0, 15] (vertical).
   * @returns The corresponding world Y coordinate.
   */
  public getWorldY(y: number): number {
    return this._chunkY * CHUNK_SIZE + y;
  }

  /**
   * Converts a local Z coordinate to a world Z coordinate.
   *
   * @param z - Local Z coordinate in range [0, 15].
   * @returns The corresponding world Z coordinate.
   */
  public getWorldZ(z: number): number {
    return this._chunkZ * CHUNK_SIZE + z;
  }
}