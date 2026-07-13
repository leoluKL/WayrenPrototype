package com.example.wayrenprototype

import android.webkit.JavascriptInterface
import android.webkit.WebView
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
    @JavascriptInterface
    fun startNativeStream(action: String, jsonPayload: String, streamId: String) {
        scope.launch(Dispatchers.IO) {
            // Track this specific coroutine job so it can be killed on command
            val currentJob = coroutineContext[Job]
            if (currentJob != null) {
                activeStreams[streamId] = currentJob
            }

            try {
                when (action) {
                    "subscribePriceStream" -> {
                        // Your real gRPC stream/flow collector loop goes here
                        while (coroutineContext.isActive) {
                            delay(1000)
                            val liveJsonChunk = "{\"price\": ${Math.random() * 100}, \"token\": \"BTC\"}"

                            withContext(Dispatchers.Main) {
                                webView.evaluateJavascript(
                                    "window.handleAndroidStreamEvent('$streamId', `$liveJsonChunk`);",
                                    null
                                )
                            }
                        }
                    }
                }
            } catch (e: CancellationException) {
                // Stream was stopped normally by the frontend
            }
        }
    }

    //Explicitly halts an open background stream
    @JavascriptInterface
    fun stopNativeStream(streamId: String) {
        activeStreams[streamId]?.cancel()
        activeStreams.remove(streamId)
    }



    private fun handleGetConnectionStatus(): String {
        val status = if (grpcClient.isConnected) "connected" else "disconnected"
        return """{"status": "$status"}"""
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
