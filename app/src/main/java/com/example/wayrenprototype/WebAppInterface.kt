package com.example.wayrenprototype

import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import io.grpc.stub.StreamObserver
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlin.time.Duration.Companion.seconds
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
                "ping" -> handleGrpcPing()
                "getConnectionStatus" -> handleGetConnectionStatus()
                "sendMessage" -> handleSendMessage(jsonPayload)
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
                    "streamAllNewMessages" -> handleStreamAllNewMessages(streamId)
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
     *    └─ StreamObserver.onNext(msg)  →  streamChannel.trySend(msg)
     *
     * 2. Channel:      buffers messages between gRPC callback and coroutine loop
     *    └─ for (message in streamChannel)  →  parseEnvelope(message)
     *
     * 3. Parse:        decodes Message.data bytes as WayrenChat Envelope
     *    └─ returns JSON: {"type":"text_message","author":"...","msg":"...","channel":...}
     *
     * 4. Internal stream: pushes JSON to WebView via evaluateJavascript
     *    └─ window.handleAndroidStreamEvent(streamId, json)
     */
    private suspend fun handleStreamAllNewMessages(streamId: String) {
        val streamChannel = Channel<ee.wayren.icp.messages.Messages.Message>(Channel.UNLIMITED)

        Log.i(TAG, "Starting StreamAllNewMessages (streamId=$streamId)...")
        grpcClient.streamAllNewMessages(object : StreamObserver<ee.wayren.icp.messages.Messages.Message> {
            override fun onNext(value: ee.wayren.icp.messages.Messages.Message) {
                streamChannel.trySend(value)
            }
            override fun onError(t: Throwable) {
                Log.e(TAG, "StreamAllNewMessages error: ${t.message}")
                streamChannel.close(t)
            }
            override fun onCompleted() {
                Log.i(TAG, "StreamAllNewMessages ended by server")
                streamChannel.close()
            }
        })

        for (message in streamChannel) {
            val json = parseEnvelope(message)
            withContext(Dispatchers.Main) {
                webView.evaluateJavascript(
                    "window.handleAndroidStreamEvent('$streamId', `$json`);",
                    null
                )
            }
        }
    }

    /** Decodes Message.data bytes as a WayrenChat Envelope and returns a JSON string. */
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

            val channelStr = payload.optString("channel", "")
            val channel = if (channelStr.isNotEmpty()) {
                channelStr.toULong()
            } else {
                null // will use default in createMessage
            }

            val success = if (channel != null) {
                grpcClient.createMessage(text, callsign, channel)
            } else {
                grpcClient.createMessage(text, callsign)
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
