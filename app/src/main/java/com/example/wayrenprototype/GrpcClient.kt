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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.time.Duration.Companion.seconds
import java.util.concurrent.TimeUnit

/**
 * Manages the gRPC connection to the Wayren Companion service running on the same device.
 * The service binds to 127.0.0.1:7073, so communication stays local and insecure.
 *
 * Automatically detects connection state — [detectGrpcChannelState] polls the service
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

    private val grpcChannel: ManagedChannel = ManagedChannelBuilder.forAddress(host, port)
        .usePlaintext()           // localhost loopback, no TLS needed
        .keepAliveTime(15, TimeUnit.SECONDS)
        .keepAliveTimeout(10, TimeUnit.SECONDS)
        .build()

    private val stub: ee.wayren.icp.services.grpc.MessageServiceGrpc.MessageServiceBlockingStub =
        ee.wayren.icp.services.grpc.MessageServiceGrpc.newBlockingStub(grpcChannel)

    private val asyncStub: ee.wayren.icp.services.grpc.MessageServiceGrpc.MessageServiceStub =
        ee.wayren.icp.services.grpc.MessageServiceGrpc.newStub(grpcChannel)

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
    suspend fun detectGrpcChannelState(appScope: CoroutineScope) {
        Log.i(TAG, "Starting continuous channel state detection at $host:$port...")
        while (true) {
            val success = ping()
            if (success) {
                if (!isConnected) {
                    isConnected = true
                    Log.i(TAG, "Connection established — Wayren Companion is reachable")

                    // Auto-send a test message to verify the connection end-to-end
                    //val testText = "WayrenPrototype connected at ${System.currentTimeMillis()}"
                    //val sent = sendWayrenChatMessage(testText, "WayrenProto")
                    //Log.i(TAG, "Auto-send test message: ${if (sent) "sent" else "failed"}")

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
        grpcChannel.shutdown()
        try {
            if (!grpcChannel.awaitTermination(5, TimeUnit.SECONDS)) {
                grpcChannel.shutdownNow()
            }
        } catch (_: InterruptedException) {
            grpcChannel.shutdownNow()
        }
    }

    /**
     * Shared: wraps raw bytes in NewMessage header/metadata and transmits over gRPC.
     *
     * @param data  The serialized payload bytes (any format — WayrenChat, C2Payload, etc.).
     * @param wayrenChannelId  Destination channel ID (uint64).
     * @return true if the message was sent successfully.
     */
    private suspend fun sendRawMessage(data: ByteArray, wayrenChannelId: ULong, priority: Int): Boolean = withContext(Dispatchers.IO) {
        try {
            val header = ee.wayren.icp.services.Services.NewMessageHeader.newBuilder()
                .setChannel(wayrenChannelId.toLong())
                .setPriority(priority)
                .build()

            val metadata = ee.wayren.icp.services.Services.NewMessageMetadata.newBuilder()
                .setShouldSync(true)
                .build()

            val newMessage = ee.wayren.icp.services.Services.NewMessage.newBuilder()
                .setHeader(header)
                .setData(ByteString.copyFrom(data))
                .setMetadata(metadata)
                .build()

            stub.createMessage(newMessage)
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
     * Sends a chat message via the CreateMessage RPC.
     * Builds an Envelope → TextMessage application-layer payload and delegates transport to [sendRawMessage].
     *
     * @param text      The message text content.
     * @param callsign  The sender callsign.
     * @param wayrenChannelId   Destination channel ID (uint64). Defaults to ALLCONCHANNEL.
     * @return true if the message was sent successfully.
     */
    suspend fun sendWayrenChatMessage(
        text: String,
        callsign: String,
        wayrenChannelId: ULong = ALLCONCHANNEL,
        priority: Int = 10
    ): Boolean {
        val textMessage = ee.wayren.chat.WayrenChat.TextMessage.newBuilder()
            .setCallsign(callsign)
            .setText(text)
            .build()

        val envelope = ee.wayren.chat.WayrenChat.Envelope.newBuilder()
            .setTextMessage(textMessage)
            .build()

        val success = sendRawMessage(envelope.toByteArray(), wayrenChannelId, priority)
        if (success) {
            Log.i(TAG, "Message sent (wayrenChannelId=$wayrenChannelId): \"$text\"")
        }
        return success
    }

    /**
     * Sends a C2Payload message via the CreateMessage RPC.
     * Serializes the C2Payload directly into `Message.data` — no WayrenChat Envelope wrapper.
     *
     * @param payload   The C2Payload to send (chat, GIS object, tactical draw, or image).
     * @param wayrenChannelId   Destination channel ID (uint64). Must be specified (no default).
     * @return true if the message was sent successfully.
     */
    suspend fun sendC2Message(
        payload: com.wayrenprototype.c2.C2.C2Payload,
        wayrenChannelId: ULong,
        priority: Int = 10
    ): Boolean {
        val raw = payload.toByteArray()
        val prefixed = ByteArray(1 + raw.size)
        prefixed[0] = 0x33.toByte()
        System.arraycopy(raw, 0, prefixed, 1, raw.size)
        val success = sendRawMessage(prefixed, wayrenChannelId, priority)
        if (success) {
            Log.i(TAG, "C2Payload sent (wayrenChannelId=$wayrenChannelId)")
        }
        return success
    }

    /**
     * Creates a new Wayren channel with the given name.
     * The server generates the channel ID (CRC64).
     *
     * @param name Human-readable channel name (e.g. "OP-ALPHA").
     * @return The created [ee.wayren.icp.channels.Channels.Channel] or null on failure.
     */
    suspend fun createWayrenChannel(name: String): ee.wayren.icp.channels.Channels.Channel? = withContext(Dispatchers.IO) {
        try {
            val newChannel = ee.wayren.icp.services.Services.NewChannel.newBuilder()
                .setName(name)
                .build()
            val result = stub.createChannel(newChannel)
            Log.i(TAG, "Channel created: ${result.name} (${result.id.toULong()})")
            result
        } catch (e: StatusRuntimeException) {
            Log.w(TAG, "CreateChannel failed (transient): ${e.status.code}")
            null
        } catch (e: Exception) {
            Log.e(TAG, "CreateChannel failed: ${e.message}")
            null
        }
    }

    /**
     * Opens a server-streaming connection to StreamAllNewMessages.
     * Each received message is delivered to the [observer].
     */
    fun streamAllNewWayrenMessages(observer: StreamObserver<ee.wayren.icp.messages.Messages.Message>) {
        asyncStub.streamAllNewMessages(Empty.getDefaultInstance(), observer)
    }

    /**
     * Opens a server-streaming connection to StreamAllChannels.
     * Each received channel is delivered to the [observer].
     */
    fun streamAllWayrenChannels(observer: StreamObserver<ee.wayren.icp.channels.Channels.Channel>) {
        asyncStub.streamAllChannels(Empty.getDefaultInstance(), observer)
    }

    /**
     * Background loop that logs all available channels and incoming messages.
     */
    private suspend fun streamLoggingLoop() {
        // ── Phase 1: detect available channels ──
        val wayrenChannelsListQueue = kotlinx.coroutines.channels.Channel<ee.wayren.icp.channels.Channels.Channel>(kotlinx.coroutines.channels.Channel.UNLIMITED)
        Log.i(TAG, "Detecting available Wayren channels...")

        streamAllWayrenChannels(object : StreamObserver<ee.wayren.icp.channels.Channels.Channel> {
            override fun onNext(value: ee.wayren.icp.channels.Channels.Channel) {
                wayrenChannelsListQueue.trySend(value)
            }
            override fun onError(t: Throwable) {
                Log.e(TAG, "Channel detection error: ${t.message}")
            }
            override fun onCompleted() {
                // stream never completes — periodic delay below handles collection
            }
        })

        // Collect whatever channels arrive in the first 2 seconds
        delay(2.seconds)
        val wayrenChannelList = mutableListOf<String>()
        while (true) {
            val result = wayrenChannelsListQueue.tryReceive()
            if (result.isSuccess) {
                val ch = result.getOrThrow()
                wayrenChannelList.add("  ${ch.name} — ${ch.id.toULong()}")
            } else {
                break
            }
        }

        if (wayrenChannelList.isEmpty()) {
            Log.i(TAG, "No channels detected")
        } else {
            Log.i(TAG, "Available channels (${wayrenChannelList.size}):")
            wayrenChannelList.forEach { Log.i(TAG, it) }
        }

        // ── Phase 2: stream and log incoming messages ──
        val wayrenMsgQueue = kotlinx.coroutines.channels.Channel<ee.wayren.icp.messages.Messages.Message>(kotlinx.coroutines.channels.Channel.UNLIMITED)
        Log.i(TAG, "Message stream logging started — waiting for messages...")

        streamAllNewWayrenMessages(object : StreamObserver<ee.wayren.icp.messages.Messages.Message> {
            override fun onNext(value: ee.wayren.icp.messages.Messages.Message) {
                wayrenMsgQueue.trySend(value)
            }
            override fun onError(t: Throwable) {
                Log.e(TAG, "Message stream logging error: ${t.message}")
                wayrenMsgQueue.close(t)
            }
            override fun onCompleted() {
                wayrenMsgQueue.close()
            }
        })

        for (msg in wayrenMsgQueue) {
            val header = msg.header
            val wayrenChannelId = header.channel.toULong()
            val data = msg.data
            val dataSize = data.size()

            val parsed = when {
                dataSize >= 1 && data.byteAt(0) == 0x33.toByte() -> {
                    // C2Payload (prefixed with 0x33)
                    try {
                        val c2 = com.wayrenprototype.c2.C2.C2Payload.parseFrom(data.substring(1))
                        val typeName = when {
                            c2.hasChat() -> "c2_chat"
                            c2.hasGisObject() -> "c2_gis_object"
                            c2.hasTacticalDraw() -> "c2_tactical_draw"
                            c2.hasImage() -> "c2_image"
                            c2.hasAudio() -> "c2_audio"
                            else -> "c2_unknown"
                        }
                        "$typeName (${dataSize - 1}B)"
                    } catch (_: Exception) {
                        "c2_parse_error (${dataSize}B)"
                    }
                }
                else -> {
                    // Try WayrenChat.Envelope (backward compatible with other apps)
                    try {
                        val envelope = ee.wayren.chat.WayrenChat.Envelope.parseFrom(data)
                        when {
                            envelope.hasTextMessage() -> {
                                val tm = envelope.textMessage
                                "text_message from \"${tm.callsign}\": \"${tm.text}\""
                            }
                            envelope.hasAckMessage() -> "ack_message from \"${envelope.ackMessage.callsign}\""
                            envelope.hasEncMessage() -> "encrypted_message (fingerprint=${envelope.encMessage.fingerprint})"
                            else -> "unknown_envelope"
                        }
                    } catch (_: Exception) {
                        "unknown_format (${dataSize}B)"
                    }
                }
            }

            Log.i(TAG, "Incoming message — channel=$wayrenChannelId | $parsed")
        }
    }
}
