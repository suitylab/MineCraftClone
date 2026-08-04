/**
 * ChunkManager.ts — Chunk management system for the Minecraft Clone.
 *
 * The ChunkManager coordinates the storage and retrieval of chunks that
 * make up the voxel world. The world spans 512×512 blocks horizontally
 * (32 chunks × 16 blocks per chunk = 512) and 128 blocks vertically.
 *
 * World coordinate system:
 * - X axis: [-256, 255] (centered on player spawn)
 * - Y axis: [0, 127] (bedrock at y=0)
 * - Z axis: [-256, 255] (centered on player spawn)
 *
 * Chunk grid: 32×8×32 chunks, where each chunk is 16×16×16 blocks.
 * Chunk coordinates range from (-16, 0, -16) to (15, 7, 15).
 *
 * The ChunkManager is a pure data container — it has no dependency on
 * Three.js and does not handle rendering. Rendering is performed
 * separately by ChunkMeshBuilder, which reads block data through this
 * manager's interface.
 */
import { Chunk, CHUNK_SIZE } from './Chunk';
import { BlockType } from './World';

/**
 * ChunkManager — Manages chunk storage and world coordinate access.
 *
 * Stores chunks in a Map keyed by 'cx,cy,cz' string for efficient
 * O(1) lookup. Provides methods for reading and writing blocks at
 * world coordinates, automatically converting between world and
 * chunk-local coordinate spaces.
 *
 * The manager handles negative world coordinates correctly:
 * - worldToChunkCoord uses floor division (Math.floor)
 * - worldToLocalCoord uses a modulo operation that handles negatives
 */
export class ChunkManager {
    /** World width along the X axis in blocks. */
  public static readonly WORLD_SIZE_X = 512;

  /** World depth along the Z axis in blocks. */
  public static readonly WORLD_SIZE_Z = 512;

  /** World height along the Y axis in blocks. */
  public static readonly WORLD_HEIGHT = 128;

  /** Number of chunks along the X axis. */
  public static readonly CHUNKS_X = ChunkManager.WORLD_SIZE_X / CHUNK_SIZE;

  /** Number of chunks along the Z axis. */
  public static readonly CHUNKS_Z = ChunkManager.WORLD_SIZE_Z / CHUNK_SIZE;

  /** Number of chunks along the Y axis. */
  public static readonly CHUNKS_Y = ChunkManager.WORLD_HEIGHT / CHUNK_SIZE;

  /** Minimum world X coordinate (inclusive). */
  public static readonly WORLD_MIN_X = -ChunkManager.WORLD_SIZE_X / 2;

  /** Maximum world X coordinate (inclusive). */
  public static readonly WORLD_MAX_X = ChunkManager.WORLD_MIN_X + ChunkManager.WORLD_SIZE_X - 1;

  /** Minimum world Z coordinate (inclusive). */
  public static readonly WORLD_MIN_Z = -ChunkManager.WORLD_SIZE_Z / 2;

  /** Maximum world Z coordinate (inclusive). */
  public static readonly WORLD_MAX_Z = ChunkManager.WORLD_MIN_Z + ChunkManager.WORLD_SIZE_Z - 1;

  /** Minimum world Y coordinate (inclusive) — bedrock layer. */
  public static readonly WORLD_MIN_Y = 0;

  /** Maximum world Y coordinate (inclusive). */
  public static readonly WORLD_MAX_Y = ChunkManager.WORLD_HEIGHT - 1;

    /** Map storing all loaded chunks, keyed by 'cx,cy,cz' string. */
  private readonly _chunks: Map<string, Chunk>;

  /** Callback invoked when a chunk needs its mesh rebuilt. */
  private _onChunkRebuild: ((chunkX: number, chunkY: number, chunkZ: number) => void) | null;

  /**
   * Creates a new empty ChunkManager.
   *
   * No chunks are loaded initially. Chunks are created on demand
   * when blocks are set or retrieved.
   */
    constructor() {
    this._chunks = new Map<string, Chunk>();
    this._onChunkRebuild = null;
  }

  /**
   * Retrieves a chunk at the given chunk coordinates.
   *
   * @param chunkX - X coordinate in chunk-grid space.
   * @param chunkY - Y coordinate in chunk-grid space (vertical).
   * @param chunkZ - Z coordinate in chunk-grid space.
   * @returns The Chunk at the given coordinates, or null if not loaded.
   */
  public getChunk(chunkX: number, chunkY: number, chunkZ: number): Chunk | null {
    const key = this.getChunkKey(chunkX, chunkY, chunkZ);
    return this._chunks.get(key) ?? null;
  }

  /**
   * Retrieves a chunk at the given chunk coordinates, creating it if needed.
   *
   * If the chunk does not exist, it is created (filled with AIR) and
   * added to the internal map before being returned.
   *
   * @param chunkX - X coordinate in chunk-grid space.
   * @param chunkY - Y coordinate in chunk-grid space (vertical).
   * @param chunkZ - Z coordinate in chunk-grid space.
   * @returns The existing or newly created Chunk.
   */
  public getOrCreateChunk(chunkX: number, chunkY: number, chunkZ: number): Chunk {
    const key = this.getChunkKey(chunkX, chunkY, chunkZ);

    // Check if the chunk already exists in the map.
    const existing = this._chunks.get(key);
    if (existing) {
      return existing;
    }

    // Create a new chunk and store it in the map.
    const chunk = new Chunk(chunkX, chunkY, chunkZ);
    this._chunks.set(key, chunk);
    return chunk;
  }

  /**
   * Gets the block type at the given world coordinates.
   *
   * Returns AIR if the coordinates are out of world bounds or if the
   * containing chunk is not loaded.
   *
   * @param worldX - World X coordinate.
   * @param worldY - World Y coordinate (vertical).
   * @param worldZ - World Z coordinate.
   * @returns The BlockType at the given position, or AIR if invalid/unloaded.
   */
  public getBlock(worldX: number, worldY: number, worldZ: number): BlockType {
    // Validate world coordinates to prevent out-of-bounds access.
    if (!this.isWorldCoordinateValid(worldX, worldY, worldZ)) {
      return BlockType.AIR;
    }

    // Convert world coordinates to chunk and local coordinates.
    const chunkX = this.worldToChunkCoord(worldX);
    const chunkY = this.worldToChunkCoord(worldY);
    const chunkZ = this.worldToChunkCoord(worldZ);

    const localX = this.worldToLocalCoord(worldX);
    const localY = this.worldToLocalCoord(worldY);
    const localZ = this.worldToLocalCoord(worldZ);

    // Retrieve the chunk; if not loaded, treat as AIR.
    const chunk = this.getChunk(chunkX, chunkY, chunkZ);
    if (!chunk) {
      return BlockType.AIR;
    }

    return chunk.getBlock(localX, localY, localZ);
  }

  /**
   * Sets the block type at the given world coordinates.
   *
   * Creates the containing chunk if it does not exist. If the coordinates
   * are out of world bounds, the operation is silently ignored.
   *
   * @param worldX - World X coordinate.
   * @param worldY - World Y coordinate (vertical).
   * @param worldZ - World Z coordinate.
   * @param type - The BlockType to set at the given position.
   */
  public setBlock(worldX: number, worldY: number, worldZ: number, type: BlockType): void {
    // Validate world coordinates to prevent out-of-bounds writes.
    if (!this.isWorldCoordinateValid(worldX, worldY, worldZ)) {
      return;
    }

    // Convert world coordinates to chunk and local coordinates.
    const chunkX = this.worldToChunkCoord(worldX);
    const chunkY = this.worldToChunkCoord(worldY);
    const chunkZ = this.worldToChunkCoord(worldZ);

    const localX = this.worldToLocalCoord(worldX);
    const localY = this.worldToLocalCoord(worldY);
    const localZ = this.worldToLocalCoord(worldZ);

    // Get or create the chunk, then set the block.
    const chunk = this.getOrCreateChunk(chunkX, chunkY, chunkZ);
    chunk.setBlock(localX, localY, localZ, type);
  }

    /**
   * Registers a callback to be invoked when a chunk needs its mesh rebuilt.
   *
   * The callback receives the chunk coordinates (chunkX, chunkY, chunkZ) of
   * the chunk that needs rebuilding. This is used by the rendering layer
   * (ChunkMesh) to rebuild the chunk's merged geometry after block changes.
   *
   * @param callback - The callback function, or null to clear the callback.
   */
  public setChunkRebuildCallback(
    callback: (chunkX: number, chunkY: number, chunkZ: number) => void
  ): void {
    this._onChunkRebuild = callback;
  }

  /**
   * Triggers a mesh rebuild for the chunk at the given chunk coordinates.
   *
   * Invokes the registered rebuild callback (if any) with the chunk
   * coordinates. The callback is typically registered by the rendering
   * layer to rebuild the chunk's merged geometry.
   *
   * @param chunkX - X coordinate in chunk-grid space.
   * @param chunkY - Y coordinate in chunk-grid space (vertical).
   * @param chunkZ - Z coordinate in chunk-grid space.
   */
  public rebuildChunk(chunkX: number, chunkY: number, chunkZ: number): void {
    if (this._onChunkRebuild) {
      this._onChunkRebuild(chunkX, chunkY, chunkZ);
    }
  }

  /**
   * Determines which chunks need rebuilding after a block change and
   * triggers their mesh rebuilds.
   *
   * A block change at the given world coordinates affects:
   * - The chunk containing the block (always)
   * - Adjacent chunks on any axis where the block is at the chunk boundary
   *   (local coordinate 0 or 15), because the block's face may be visible
   *   from the adjacent chunk
   *
   * @param worldX - World X coordinate of the modified block.
   * @param worldY - World Y coordinate of the modified block.
   * @param worldZ - World Z coordinate of the modified block.
   */
  public rebuildChunksAroundBlock(worldX: number, worldY: number, worldZ: number): void {
    // Convert world coordinates to chunk and local coordinates.
    const chunkX = this.worldToChunkCoord(worldX);
    const chunkY = this.worldToChunkCoord(worldY);
    const chunkZ = this.worldToChunkCoord(worldZ);

    const localX = this.worldToLocalCoord(worldX);
    const localY = this.worldToLocalCoord(worldY);
    const localZ = this.worldToLocalCoord(worldZ);

    // Always rebuild the containing chunk.
    this.rebuildChunk(chunkX, chunkY, chunkZ);

    // If the block is at the chunk boundary on any axis, the adjacent
    // chunk on that axis also needs rebuilding (its face culling may
    // change because the modified block's face is visible from there).
    if (localX === 0) {
      this.rebuildChunk(chunkX - 1, chunkY, chunkZ);
    }
    if (localX === CHUNK_SIZE - 1) {
      this.rebuildChunk(chunkX + 1, chunkY, chunkZ);
    }
    if (localY === 0) {
      this.rebuildChunk(chunkX, chunkY - 1, chunkZ);
    }
    if (localY === CHUNK_SIZE - 1) {
      this.rebuildChunk(chunkX, chunkY + 1, chunkZ);
    }
    if (localZ === 0) {
      this.rebuildChunk(chunkX, chunkY, chunkZ - 1);
    }
    if (localZ === CHUNK_SIZE - 1) {
      this.rebuildChunk(chunkX, chunkY, chunkZ + 1);
    }
  }

  /**
   * Converts a world coordinate to a chunk coordinate.
   *
   * Uses floor division to correctly handle negative coordinates.
   * For example, world coordinate -1 maps to chunk coordinate -1
   * (since -1 / 16 = -0.0625, floored to -1).
   *
   * @param worldCoord - World coordinate along any axis.
   * @returns The corresponding chunk coordinate.
   */
  public worldToChunkCoord(worldCoord: number): number {
    return Math.floor(worldCoord / CHUNK_SIZE);
  }

  /**
   * Converts a world coordinate to a local chunk coordinate.
   *
   * Uses a modulo operation that correctly handles negative coordinates.
   * JavaScript's % operator returns a negative result for negative operands,
   * so we add CHUNK_SIZE and take modulo again to ensure a positive result
   * in the range [0, CHUNK_SIZE - 1].
   *
   * @param worldCoord - World coordinate along any axis.
   * @returns The corresponding local coordinate in range [0, 15].
   */
  public worldToLocalCoord(worldCoord: number): number {
    // Handle negative coordinates: ((worldCoord % 16) + 16) % 16
    // Example: worldCoord = -1 → ((-1 % 16) + 16) % 16 = (15 + 16) % 16 = 15
    return ((worldCoord % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  }

  /**
   * Generates the map key for the given chunk coordinates.
   *
   * The key format is 'cx,cy,cz' (e.g., '-1,2,3').
   *
   * @param cx - X coordinate in chunk-grid space.
   * @param cy - Y coordinate in chunk-grid space (vertical).
   * @param cz - Z coordinate in chunk-grid space.
   * @returns The string key used for Map lookups.
   */
  public getChunkKey(cx: number, cy: number, cz: number): string {
    return `${cx},${cy},${cz}`;
  }

  /**
   * Returns all currently loaded chunks.
   *
   * @returns An array of all Chunk objects in the manager.
   */
  public getLoadedChunks(): Chunk[] {
    return Array.from(this._chunks.values());
  }

  /**
   * Returns the number of currently loaded chunks.
   *
   * @returns The count of chunks stored in the manager.
   */
  public getChunkCount(): number {
    return this._chunks.size;
  }

  /**
   * Checks whether the given world coordinates are within world bounds.
   *
   * Valid ranges:
   * - X: [WORLD_MIN_X, WORLD_MAX_X] = [-64, 63]
   * - Y: [WORLD_MIN_Y, WORLD_MAX_Y] = [0, 127]
   * - Z: [WORLD_MIN_Z, WORLD_MAX_Z] = [-64, 63]
   *
   * @param worldX - World X coordinate.
   * @param worldY - World Y coordinate (vertical).
   * @param worldZ - World Z coordinate.
   * @returns True if all coordinates are within valid bounds, false otherwise.
   */
  public isWorldCoordinateValid(worldX: number, worldY: number, worldZ: number): boolean {
    return (
      worldX >= ChunkManager.WORLD_MIN_X && worldX <= ChunkManager.WORLD_MAX_X &&
      worldY >= ChunkManager.WORLD_MIN_Y && worldY <= ChunkManager.WORLD_MAX_Y &&
      worldZ >= ChunkManager.WORLD_MIN_Z && worldZ <= ChunkManager.WORLD_MAX_Z
    );
  }
}