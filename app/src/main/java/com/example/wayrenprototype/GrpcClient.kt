package com.example.wayrenprototype

import android.util.Log
import com.google.protobuf.Empty
import io.grpc.ManagedChannel
import io.grpc.ManagedChannelBuilder
import io.grpc.StatusRuntimeException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * Manages the gRPC connection to the Wayren Companion service running on the same device.
 * The service binds to 127.0.0.1:7073, so communication stays local and insecure.
 *
 * Automatically detects connection state — [detectChannelState] polls the service
 * every 3 seconds and updates [isConnected] for the frontend to query.
 */
class GrpcClient(
    private val host: String = "127.0.0.1",
    private val port: Int = 7073
) {
    companion object {
        private const val TAG = "WayrenApp"
        private const val DEFAULT_RETRY_INTERVAL_MS = 3000L
    }

    /** Whether we've ever successfully connected to the service. */
    @Volatile
    var isConnected: Boolean = false
        private set

    private val channel: ManagedChannel = ManagedChannelBuilder.forAddress(host, port)
        .usePlaintext()           // localhost loopback, no TLS needed
        .keepAliveTime(15, TimeUnit.SECONDS)
        .keepAliveTimeout(10, TimeUnit.SECONDS)
        .build()

    private val stub: ee.wayren.icp.services.grpc.MessageServiceGrpc.MessageServiceBlockingStub =
        ee.wayren.icp.services.grpc.MessageServiceGrpc.newBlockingStub(channel)

    /**
     * Sends a Ping RPC to verify the Wayren Companion service is reachable.
     * Returns true if the service responded successfully, false otherwise.
     */
    suspend fun ping(): Boolean = withContext(Dispatchers.IO) {
        try {
            stub.ping(Empty.getDefaultInstance())
            true
        } catch (e: StatusRuntimeException) {
            Log.w(TAG, "Ping failed (transient): ${e.status.code}")
            false
        } catch (e: Exception) {
            Log.e(TAG, "Ping failed: ${e.message}")
            false
        }
    }

    /**
     * Continuously monitors the connection to the Wayren Companion service.
     * Pings every [DEFAULT_RETRY_INTERVAL_MS] and updates [isConnected].
     * Designed to be launched as a background coroutine that runs forever.
     */
    suspend fun detectChannelState() {
        Log.i(TAG, "Starting continuous channel state detection at $host:$port...")
        while (true) {
            val success = ping()
            if (success) {
                if (!isConnected) {
                    isConnected = true
                    Log.i(TAG, "Connection established — Wayren Companion is reachable")
                }
            } else {
                if (isConnected) {
                    isConnected = false
                    Log.w(TAG, "Connection lost — Wayren Companion is unreachable")
                }
            }
            delay(DEFAULT_RETRY_INTERVAL_MS)
        }
    }

    /**
     * Gracefully shuts down the gRPC channel.
     * Call this when the app is destroyed or no longer needs gRPC.
     */
    fun shutdown() {
        isConnected = false
        channel.shutdown()
        try {
            if (!channel.awaitTermination(5, TimeUnit.SECONDS)) {
                channel.shutdownNow()
            }
        } catch (e: InterruptedException) {
            channel.shutdownNow()
        }
    }
}
