package com.example.wayrenprototype

import android.util.Log
import com.google.protobuf.ByteString
import com.google.protobuf.Empty
import io.grpc.ManagedChannel
import io.grpc.ManagedChannelBuilder
import io.grpc.StatusRuntimeException
import io.grpc.stub.StreamObserver
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.time.Duration.Companion.seconds
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
        private val RETRY_INTERVAL = 3.seconds

        // Channel IDs (uint64). ALLCONCHANNEL exceeds Long.MAX_VALUE so we store as ULong.
        private val ALLCONCHANNEL = 16140341465198178175uL
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

    private val asyncStub: ee.wayren.icp.services.grpc.MessageServiceGrpc.MessageServiceStub =
        ee.wayren.icp.services.grpc.MessageServiceGrpc.newStub(channel)

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
     * Pings every [RETRY_INTERVAL] and updates [isConnected].
     * Designed to be launched as a background coroutine that runs forever.
     *
     * @param appScope used to launch the stream-logging coroutine on first connect.
     */
    suspend fun detectChannelState(appScope: CoroutineScope = GlobalScope) {
        Log.i(TAG, "Starting continuous channel state detection at $host:$port...")
        while (true) {
            val success = ping()
            if (success) {
                if (!isConnected) {
                    isConnected = true
                    Log.i(TAG, "Connection established — Wayren Companion is reachable")

                    // Auto-send a test message to verify the connection end-to-end
                    val testText = "WayrenPrototype connected at ${System.currentTimeMillis()}"
                    val sent = createMessage(testText, "WayrenProto")
                    Log.i(TAG, "Auto-send test message: ${if (sent) "sent" else "failed"}")

                    // Also start stream logging for all new messages
                    appScope.launch(Dispatchers.IO) {
                        streamLoggingLoop()
                    }
                }
            } else {
                if (isConnected) {
                    isConnected = false
                    Log.w(TAG, "Connection lost — Wayren Companion is unreachable")
                }
            }
            delay(RETRY_INTERVAL)
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
        } catch (_: InterruptedException) {
            channel.shutdownNow()
        }
    }

    /**
     * Sends a chat message via the CreateMessage RPC.
     * Builds an Envelope → TextMessage application-layer payload, wraps it in a
     * NewMessage with header + metadata, and transmits over gRPC.
     *
     * @param text      The message text content.
     * @param callsign  The sender callsign.
     * @param channel   Destination channel ID (uint64). Defaults to ALLCONCHANNEL.
     * @return true if the message was sent successfully.
     */
    suspend fun createMessage(
        text: String,
        callsign: String,
        channel: ULong = ALLCONCHANNEL
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            // 1. Build the application-layer Envelope containing a TextMessage
            val textMessage = ee.wayren.chat.WayrenChat.TextMessage.newBuilder()
                .setCallsign(callsign)
                .setText(text)
                .build()

            val envelope = ee.wayren.chat.WayrenChat.Envelope.newBuilder()
                .setTextMessage(textMessage)
                .build()

            val encodedData = envelope.toByteArray()

            // 2. Wrap in the transport-layer NewMessage
            val header = ee.wayren.icp.services.Services.NewMessageHeader.newBuilder()
                .setChannel(channel.toLong())
                .setPriority(10)
                .build()

            val metadata = ee.wayren.icp.services.Services.NewMessageMetadata.newBuilder()
                .setShouldSync(true)
                .build()

            val newMessage = ee.wayren.icp.services.Services.NewMessage.newBuilder()
                .setHeader(header)
                .setData(ByteString.copyFrom(encodedData))
                .setMetadata(metadata)
                .build()

            // 3. Transmit
            stub.createMessage(newMessage)
            Log.i(TAG, "Message sent (channel=$channel): \"$text\"")
            true
        } catch (e: StatusRuntimeException) {
            Log.w(TAG, "CreateMessage failed (transient): ${e.status.code}")
            false
        } catch (e: Exception) {
            Log.e(TAG, "CreateMessage failed: ${e.message}")
            false
        }
    }

    /**
     * Opens a server-streaming connection to StreamAllNewMessages.
     * Each received message is delivered to the [observer].
     */
    fun streamAllNewMessages(observer: StreamObserver<ee.wayren.icp.messages.Messages.Message>) {
        asyncStub.streamAllNewMessages(Empty.getDefaultInstance(), observer)
    }

    /**
     * Background loop that logs all incoming stream messages.
     */
    private suspend fun streamLoggingLoop() {
        val channel = Channel<ee.wayren.icp.messages.Messages.Message>(Channel.UNLIMITED)
        Log.i(TAG, "Stream logging started — waiting for messages...")

        streamAllNewMessages(object : StreamObserver<ee.wayren.icp.messages.Messages.Message> {
            override fun onNext(value: ee.wayren.icp.messages.Messages.Message) {
                channel.trySend(value)
            }
            override fun onError(t: Throwable) {
                Log.e(TAG, "Stream logging error: ${t.message}")
                channel.close(t)
            }
            override fun onCompleted() {
                channel.close()
            }
        })

        for (msg in channel) {
            val header = msg.header
            val channelId = header.channel.toULong()

            // Parse the data bytes as a WayrenChat Envelope (same as stream.js)
            val parsed = try {
                val envelope = ee.wayren.chat.WayrenChat.Envelope.parseFrom(msg.data)
                when {
                    envelope.hasTextMessage() -> {
                        val tm = envelope.textMessage
                        "text_message from \"${tm.callsign}\": \"${tm.text}\""
                    }
                    envelope.hasAckMessage() -> {
                        "ack_message from \"${envelope.ackMessage.callsign}\""
                    }
                    envelope.hasEncMessage() -> {
                        "encrypted_message (fingerprint=${envelope.encMessage.fingerprint})"
                    }
                    else -> "unknown_envelope_format"
                }
            } catch (e: Exception) {
                "parsing_error: ${e.message}"
            }

            Log.i(TAG, "Incoming message — channel=$channelId | $parsed")
        }
    }
}
