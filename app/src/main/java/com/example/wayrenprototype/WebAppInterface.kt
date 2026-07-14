package com.example.wayrenprototype

import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import io.grpc.stub.StreamObserver
import kotlinx.coroutines.*
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

class WebAppInterface(
    private val webView: WebView,
    private val scope: CoroutineScope,
    private val grpcClient: GrpcClient
) {
    // Keeps track of active gRPC stream collection jobs mapped by streamId
    private val activeStreams = ConcurrentHashMap<String, Job>()

    //Handles standard, one-time data requests (Request-Response)
    @Suppress("unused")
    @JavascriptInterface
    fun sendToNative(action: String, jsonPayload: String, callbackId: String) {
        // NOTE: For streams, the "callbackId" parameter becomes your "streamId" channel name

        // Run on background thread so the gRPC network call never freezes your React UI
        scope.launch(Dispatchers.IO) {
            // 1. Process your action and incoming payload
            val jsonResponse = when (action) {
                "pinggRPC" -> handleGrpcPing()
                "getgRPCConnectionStatus" -> handleGetConnectionStatus()
                "sendWayrenMessage" -> handleSendMessage(jsonPayload)
                else -> "{\"error\": \"Unknown action: $action\"}"
            }

            // 2. Return the result back to JavaScript on the main UI thread
            withContext(Dispatchers.Main) {
                webView.evaluateJavascript(
                    "window.handleAndroidResponse('$callbackId', `$jsonResponse`);",
                    null
                )
            }
        }
    }

    //Handles long-running gRPC data streams (Publish-Subscribe)
    @Suppress("unused")
    @JavascriptInterface
    fun startNativeInternalStream(action: String, jsonPayload: String, streamId: String) {
        scope.launch(Dispatchers.IO) {
            // Track this specific coroutine job so it can be killed on command
            val currentJob = coroutineContext[Job]
            if (currentJob != null) {
                activeStreams[streamId] = currentJob
            }

            try {
                when (action) {
                    "streamAllWayrenNewMessages" -> handleStreamAllNewMessages(streamId) //receive message from all possible wayren channels
                    "streamAllWayrenChannels" -> handleStreamAllWayrenChannels(streamId) //list all available channels
                }
            } catch (e: CancellationException) {
                // Stream was stopped normally by the frontend
            }
        }
    }

    //Explicitly halts an open background stream
    @Suppress("unused")
    @JavascriptInterface
    fun stopNativeInternalStream(streamId: String) {
        activeStreams[streamId]?.cancel()
        activeStreams.remove(streamId)
    }



    companion object {
        private const val TAG = "WayrenApp"
    }

    private fun handleGetConnectionStatus(): String {
        val status = if (grpcClient.isConnected) "connected" else "disconnected"
        return """{"status": "$status"}"""
    }

    /**
     * Data pipeline: gRPC stream → Channel → parse → internal stream → WebView
     *
     * 1. gRPC stream:  receives Messages from Companion (Singularity network)
     *    └─ StreamObserver.onNext(msg)  →  wayrenMsgQueue.trySend(msg)
     *
     * 2. Queue:       buffers messages between gRPC callback and coroutine loop
     *    └─ for (message in wayrenMsgQueue)  →  parseEnvelope(message)
     *
     * 3. Parse:        Decodes `Message.data` bytes as WayrenChat Envelope
     *    └─ returns JSON: {"type":"text_message","author":"...","msg":"...","channel":...}
     *
     * 4. Internal stream: pushes JSON to WebView via evaluateJavascript
     *    └─ window.handleAndroidStreamEvent(streamId, JSON)
     */
    private suspend fun handleStreamAllNewMessages(streamId: String) {
        val wayrenMsgQueue = kotlinx.coroutines.channels.Channel<ee.wayren.icp.messages.Messages.Message>(kotlinx.coroutines.channels.Channel.UNLIMITED)

        Log.i(TAG, "Starting StreamAllNewMessages (streamId=$streamId)...")
        grpcClient.streamAllNewWayrenMessages(object : StreamObserver<ee.wayren.icp.messages.Messages.Message> {
            override fun onNext(value: ee.wayren.icp.messages.Messages.Message) {
                wayrenMsgQueue.trySend(value)
            }
            override fun onError(t: Throwable) {
                Log.e(TAG, "StreamAllNewMessages error: ${t.message}")
                wayrenMsgQueue.close(t)
            }
            override fun onCompleted() {
                Log.i(TAG, "StreamAllNewMessages ended by server")
                wayrenMsgQueue.close()
            }
        })

        for (message in wayrenMsgQueue) {
            val json = parseEnvelope(message)
            withContext(Dispatchers.Main) {
                webView.evaluateJavascript(
                    "window.handleAndroidStreamEvent('$streamId', `$json`);",
                    null
                )
            }
        }
    }

    private suspend fun handleStreamAllWayrenChannels(streamId: String) {
        val wayrenChannelsListQueue = kotlinx.coroutines.channels.Channel<ee.wayren.icp.channels.Channels.Channel>(kotlinx.coroutines.channels.Channel.UNLIMITED)

        Log.i(TAG, "Starting StreamAllChannels (streamId=$streamId)...")
        grpcClient.streamAllWayrenChannels(object : StreamObserver<ee.wayren.icp.channels.Channels.Channel> {
            override fun onNext(value: ee.wayren.icp.channels.Channels.Channel) {
                wayrenChannelsListQueue.trySend(value)
            }
            override fun onError(t: Throwable) {
                Log.e(TAG, "StreamAllChannels error: ${t.message}")
                wayrenChannelsListQueue.close(t)
            }
            override fun onCompleted() {
                Log.i(TAG, "StreamAllChannels ended by server")
                wayrenChannelsListQueue.close()
            }
        })

        for (ch in wayrenChannelsListQueue) {
            val json = """{"id":${ch.id.toULong()},"name":"${ch.name}"}"""
            withContext(Dispatchers.Main) {
                webView.evaluateJavascript(
                    "window.handleAndroidStreamEvent('$streamId', `$json`);",
                    null
                )
            }
        }
    }

    /** Decodes `Message.data` bytes as a WayrenChat Envelope and returns a JSON string. */
    private fun parseEnvelope(message: ee.wayren.icp.messages.Messages.Message): String {
        return try {
            val envelope = ee.wayren.chat.WayrenChat.Envelope.parseFrom(message.data)
            val header = message.header
            val channel = header.channel

            if (envelope.hasTextMessage()) {
                val tm = envelope.textMessage
                """{"type":"text_message","author":"${tm.callsign}","msg":"${tm.text}","channel":$channel}"""
            } else if (envelope.hasAckMessage()) {
                val am = envelope.ackMessage
                """{"type":"ack_message","author":"${am.callsign}","channel":$channel}"""
            } else if (envelope.hasEncMessage()) {
                """{"type":"encrypted_message","fingerprint":${envelope.encMessage.fingerprint},"channel":$channel}"""
            } else {
                """{"type":"unknown_envelope"}"""
            }
        } catch (e: Exception) {
            """{"type":"parsing_error","error":"${e.message}"}"""
        }
    }

    private suspend fun handleSendMessage(jsonPayload: String): String {
        return try {
            val payload = JSONObject(jsonPayload)
            val text = payload.optString("text", "")
            val callsign = payload.optString("callsign", "Android App")

            val wayrenChannelIdStr = payload.optString("channel", "")
            val wayrenChannelId = if (wayrenChannelIdStr.isNotEmpty()) {
                wayrenChannelIdStr.toULong()
            } else {
                null // will use default in createWayrenMessage
            }

            val success = if (wayrenChannelId != null) {
                grpcClient.createWayrenMessage(text, callsign, wayrenChannelId)
            } else {
                grpcClient.createWayrenMessage(text, callsign)
            }

            if (success) {
                """{"status": "ok", "message": "Message sent"}"""
            } else {
                """{"status": "error", "message": "Failed to send message"}"""
            }
        } catch (e: Exception) {
            """{"status": "error", "message": "sendMessage failed: ${e.message}"}"""
        }
    }

    private suspend fun handleGrpcPing(): String {
        return try {
            val success = grpcClient.ping()
            if (success) {
                """{"status": "ok", "message": "pong"}"""
            } else {
                """{"status": "error", "message": "gRPC ping returned failure"}"""
            }
        } catch (e: Exception) {
            """{"status": "error", "message": "gRPC ping failed: ${e.message}"}"""
        }
    }
}
