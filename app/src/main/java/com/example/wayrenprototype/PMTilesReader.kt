package com.example.wayrenprototype

import android.util.Log
import java.io.ByteArrayInputStream
import java.io.RandomAccessFile
import java.util.zip.GZIPInputStream
import kotlin.io.use

/**
 * Reads PMTiles v3 archives from a local file.
 *
 * Uses [RandomAccessFile] for random seeks — the caller should copy the .pmtiles
 * file from Android assets to internal storage before constructing this reader
 * (AssetManager does not support random-access reads).
 */
class PMTilesReader(private val path: String) {
    companion object {
        private const val TAG = "WayrenApp"
        private const val HEADER_SIZE = 127
        private const val MAGIC_LE = 0x4D50   // "PM" in little-endian uint16

        // Compression enum values matching PMTiles spec
        private const val COMPRESSION_NONE = 1
        private const val COMPRESSION_GZIP = 2

        /**
         * Convert z/x/y tile coordinates to PMTiles tile ID using Hilbert curve encoding.
         * Matches the npm pmtiles reference implementation exactly.
         */
        fun zxyToTileId(z: Int, x: Int, y: Int): Long {
            require(z <= 26) { "Zoom level exceeds max (26)" }
            require(x < 1 shl z && y < 1 shl z) { "Tile x/y outside zoom bounds" }

            val size = 1L shl z
            var tileId = (size * size - 1) / 3L
            var ix = x.toLong()
            var iy = y.toLong()

            if (z > 0) {
                var scale = 1L shl (z - 1)
                var i = z - 1
                while (scale > 0) {
                    val xBit = ix and scale
                    val yBit = iy and scale
                    tileId += ((3L * xBit) xor yBit) * (1L shl i)

                    // Hilbert rotation (matches npm pmtiles `rotate` function)
                    val nx: Long
                    val ny: Long
                    if (yBit == 0L) {
                        if (xBit != 0L) {
                            nx = scale - 1 - iy
                            ny = scale - 1 - ix
                        } else {
                            nx = iy
                            ny = ix
                        }
                    } else {
                        nx = ix
                        ny = iy
                    }
                    ix = nx
                    iy = ny

                    scale = scale shr 1
                    i--
                }
            }

            return tileId
        }
    }

    data class Header(
        val rootDirOffset: Long,
        val rootDirLength: Long,
        val leafDirsOffset: Long,
        val leafDirsLength: Long,
        val tileDataOffset: Long,
        val internalCompression: Int,
        val tileCompression: Int,
        val tileType: Int,
        val minZoom: Int,
        val maxZoom: Int,
    )

    /**
     * A single PMTiles directory entry. When [runLength] is 0, the entry points
     * to a leaf directory rather than tile data.
     */
    data class Entry(
        val tileId: Long,
        val runLength: Long,
        val offset: Long,
        val length: Long,
    )

    /** Parsed header, available after construction. */
    val header: Header

    private var raf: RandomAccessFile? = null

    init {
        val file = RandomAccessFile(path, "r")
        raf = file

        val headerBytes = ByteArray(HEADER_SIZE)
        file.readFully(headerBytes)

        // Validate magic (LE uint16 "PM")
        val magic = ((headerBytes[1].toInt() and 0xFF) shl 8) or (headerBytes[0].toInt() and 0xFF)
        require(magic == MAGIC_LE) { "Not a PMTiles file: magic=0x${magic.toString(16)}" }

        val version = headerBytes[7].toInt() and 0xFF
        require(version == 3) { "Unsupported PMTiles version: $version" }

        header = Header(
            rootDirOffset     = readUint64LE(headerBytes, 8),
            rootDirLength     = readUint64LE(headerBytes, 16),
            leafDirsOffset    = readUint64LE(headerBytes, 40),
            leafDirsLength    = readUint64LE(headerBytes, 48),
            tileDataOffset    = readUint64LE(headerBytes, 56),
            internalCompression = headerBytes[97].toInt() and 0xFF,
            tileCompression   = headerBytes[98].toInt() and 0xFF,
            tileType          = headerBytes[99].toInt() and 0xFF,
            minZoom           = headerBytes[100].toInt() and 0xFF,
            maxZoom           = headerBytes[101].toInt() and 0xFF,
        )

        Log.i(TAG, "PMTiles: version=$version z=${header.minZoom}-${header.maxZoom} " +
                "tileType=${header.tileType} internalCompression=${header.internalCompression} " +
                "tileCompression=${header.tileCompression} " +
                "rootDir=${header.rootDirLength}B leafDirs=${header.leafDirsLength}B")
    }

    // ── Public API ──

    /**
     * Retrieves tile bytes for the given z/x/y coordinate.
     * Returns null if the tile doesn't exist in the archive.
     */
    fun getTile(z: Int, x: Int, y: Int): ByteArray? {
        val tileId = zxyToTileId(z, x, y)
        val file = raf ?: return null

        var dirOffset = header.rootDirOffset
        var dirLength = header.rootDirLength

        // Walk the directory tree (max 4 levels as recommended by spec)
        for (depth in 0..3) {
            val entries = readDirectory(file, dirOffset, dirLength)
            val entry = findEntry(entries, tileId) ?: return null

            if (entry.runLength > 0) {
                // Points to tile data
                if (entry.length <= 0) return null
                val raw = ByteArray(entry.length.toInt())
                synchronized(file) {
                    file.seek(header.tileDataOffset + entry.offset)
                    file.readFully(raw)
                }
                // Decompress tiles if the archive uses gzip compression
                return if (header.tileCompression == COMPRESSION_GZIP) {
                    gunzip(raw)
                } else {
                    raw
                }
            }

            // runLength == 0 → points to a leaf directory
            dirOffset = header.leafDirsOffset + entry.offset
            dirLength = entry.length
        }

        Log.w(TAG, "Max directory depth exceeded for z=$z x=$x y=$y (tileId=$tileId)")
        return null
    }

    fun close() {
        raf?.close()
        raf = null
    }

    // ── Directory reader ──

    /**
     * Reads and deserializes a PMTiles directory at [offset] with [length] bytes.
     * Handles gzip decompression when [header.internalCompression] requires it.
     */
    private fun readDirectory(file: RandomAccessFile, offset: Long, length: Long): List<Entry> {
        val raw = ByteArray(length.toInt())
        synchronized(file) {
            file.seek(offset)
            file.readFully(raw)
        }

        val data: ByteArray = if (header.internalCompression == COMPRESSION_GZIP) {
            gunzip(raw)
        } else {
            raw
        }

        return deserializeIndex(data)
    }

    /**
     * Deserializes the varint-encoded PMTiles v3 index format.
     *
     * Layout: [numEntries_varint]
     *         [tileIdDelta_varint] × numEntries
     *         [runLength_varint]   × numEntries
     *         [length_varint]      × numEntries
     *         [offset_varint]      × numEntries   (delta-encoded)
     */
    private fun deserializeIndex(data: ByteArray): List<Entry> {
        val reader = VarintReader(data)
        val numEntries = reader.readVarint().toInt()
        if (numEntries == 0) return emptyList()

        val entries = mutableListOf<Entry>()

        // 1) Tile IDs (delta-encoded)
        var runningTileId = 0L
        val tileIds = LongArray(numEntries)
        for (i in 0 until numEntries) {
            val delta = reader.readVarint()
            runningTileId += delta
            tileIds[i] = runningTileId
        }

        // 2) Run lengths
        val runLengths = LongArray(numEntries)
        for (i in 0 until numEntries) {
            runLengths[i] = reader.readVarint()
        }

        // 3) Lengths
        val lengths = LongArray(numEntries)
        for (i in 0 until numEntries) {
            lengths[i] = reader.readVarint()
        }

        // 4) Offsets (delta-encoded, special: 0 means "same as previous")
        var runningOffset = 0L
        for (i in 0 until numEntries) {
            val delta = reader.readVarint()
            if (delta == 0L && i > 0) {
                runningOffset += lengths[i - 1]
            } else {
                runningOffset = delta - 1
            }
            entries.add(Entry(
                tileId = tileIds[i],
                runLength = runLengths[i],
                offset = runningOffset,
                length = lengths[i],
            ))
        }

        return entries
    }

    // ── Binary search ──

    /**
     * Binary search for a directory entry covering [tileId].
     *
     * The entry at index i covers tile IDs from [entry.tileId] to
     * [entry.tileId] + [entry.runLength] - 1, or when runLength == 0,
     * it covers all IDs up to the next entry.
     */
    private fun findEntry(entries: List<Entry>, tileId: Long): Entry? {
        var lo = 0
        var hi = entries.size - 1

        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            val entry = entries[mid]
            val diff = tileId - entry.tileId

            if (diff < 0) {
                hi = mid - 1
            } else if (diff > 0) {
                lo = mid + 1
            } else {
                return entry // exact match
            }
        }

        // "hi" is now the entry right before our tileId.
        // Check if it covers the requested tile via runLength.
        if (hi >= 0) {
            val prev = entries[hi]
            val diff = tileId - prev.tileId
            if (prev.runLength == 0L || diff < prev.runLength) {
                return prev
            }
        }

        return null
    }

    // ── Helpers ──

    private fun readUint64LE(buf: ByteArray, offset: Int): Long {
        var result = 0L
        for (i in 0 until 8) {
            result = result or ((buf[offset + i].toLong() and 0xFF) shl (i * 8))
        }
        return result
    }

    private fun gunzip(data: ByteArray): ByteArray {
        return GZIPInputStream(ByteArrayInputStream(data)).use { it.readBytes() }
    }

    /** Simple varint decoder that reads unsigned varints from a byte array. */
    private class VarintReader(private val data: ByteArray) {
        var pos = 0

        fun readVarint(): Long {
            var result = 0L
            var shift = 0
            while (pos < data.size) {
                val byte = data[pos++].toInt() and 0xFF
                result = result or ((byte and 0x7F).toLong() shl shift)
                if (byte and 0x80 == 0) return result
                shift += 7
                if (shift > 63) throw IllegalArgumentException("Varint too long")
            }
            throw IllegalArgumentException("Unexpected end of varint data")
        }
    }
}
