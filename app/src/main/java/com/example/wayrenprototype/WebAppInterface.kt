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
                "getDeviceName" -> handleGetDeviceName()
                "sendWayrenMessage" -> handleSendWayrenChatMessage(jsonPayload)
                "sendC2Payload" -> handleSendC2Payload(jsonPayload)
                "createWayrenChannel" -> handleCreateWayrenChannel(jsonPayload)
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
                    "streamAllWayrenNewMessages" -> {
                        if (grpcClient.isConnected) {
                            handleStreamAllNewMessages(streamId)
                        } else {
                            Log.w(TAG, "Defer stream '$action': service not connected")
                        }
                    }
                    "streamAllWayrenChannels" -> {
                        if (grpcClient.isConnected) {
                            handleStreamAllWayrenChannels(streamId)
                        } else {
                            Log.w(TAG, "Defer stream '$action': service not connected")
                        }
                    }
                }
            } catch (e: CancellationException) {
                // Stream was stopped normally by the frontend
            } catch (e: Exception) {
                Log.e(TAG, "Stream '$action' crashed: ${e.message}")
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

    private fun handleGetDeviceName(): String {
        val name = try {
            val deviceName = android.provider.Settings.Global.getString(
                webView.context.contentResolver,
                "device_name"
            )
            if (!deviceName.isNullOrBlank()) deviceName else null
        } catch (_: Exception) {
            null
        } ?: android.os.Build.MODEL

        return """{"name": "$name"}"""
    }

    /**
     * Data pipeline: gRPC stream → Channel → parse → internal stream → WebView
     *
     * 1. gRPC stream:  receives Messages from Companion (Singularity network)
     *    └─ StreamObserver.onNext(msg)  →  wayrenMsgQueue.trySend(msg)
     *
     * 2. Queue:       buffers messages between gRPC callback and coroutine loop
     *    └─ for (message in wayrenMsgQueue)  →  parseMessageData(message)
     *
     * 3. Parse:        Decodes `Message.data` bytes as C2Payload (our app's format only)
     *    └─ returns JSON: {"type":"c2_chat","from":"...","text":"...","channel":...}
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
            val json = parseMessageData(message) ?: continue // skip non-C2Payload messages
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
            val json = """{"id":"${ch.id.toULong()}","name":"${ch.name}"}"""
            withContext(Dispatchers.Main) {
                webView.evaluateJavascript(
                    "window.handleAndroidStreamEvent('$streamId', `$json`);",
                    null
                )
            }
        }
    }

    /**
     * Decodes `Message.data` bytes. Expects first byte prefix 0x33 for C2Payload.
     * Returns null for any other message (e.g. WayrenChat from other apps).
     */
    private fun parseMessageData(message: ee.wayren.icp.messages.Messages.Message): String? {
        val channelStr = message.header.channel.toULong().toString()
        val data = message.data
        if (data.isEmpty()) return null
        if (data.byteAt(0) != 0x33.toByte()) return null

        return try {
            val c2 = com.wayrenprototype.c2.C2.C2Payload.parseFrom(data.substring(1))
            parseC2Payload(c2, channelStr)
        } catch (_: Exception) {
            null
        }
    }

    /** Decodes a C2Payload and returns a JSON string for the frontend. */
    private fun parseC2Payload(payload: com.wayrenprototype.c2.C2.C2Payload, channelStr: String): String {
        return when {
            payload.hasChat() -> {
                val chat = payload.chat
                """{"type":"c2_chat","from":"${chat.fromCallsign}","text":"${chat.text}","uuid":"${chat.uuid}","channel":"$channelStr"}"""
            }
            payload.hasGisObject() -> {
                val gis = payload.gisObject
                """{"type":"c2_gis_object","object_id":"${gis.objectId}","name":"${gis.name}","channel":"$channelStr"}"""
            }
            payload.hasTacticalDraw() -> {
                val draw = payload.tacticalDraw
                """{"type":"c2_tactical_draw","draw_id":"${draw.drawId}","name":"${draw.name}","channel":"$channelStr"}"""
            }
            payload.hasImage() -> {
                val img = payload.image
                Log.i(TAG, "Received C2Image: raw=${img.data.size()}B mime=${img.mimeType}")
                val b64 = android.util.Base64.encodeToString(img.data.toByteArray(), android.util.Base64.NO_WRAP)
                """{"type":"c2_image","image_id":"${img.imageId}","uuid":"${img.uuid}","mime":"${img.mimeType}","data":"$b64","from":"${img.fromCallsign}","channel":"$channelStr"}"""
            }
            payload.hasAudio() -> {
                val aud = payload.audio
                Log.i(TAG, "Received C2Audio: raw=${aud.data.size()}B mime=${aud.mimeType} dur=${aud.durationSec}s")
                val b64 = android.util.Base64.encodeToString(aud.data.toByteArray(), android.util.Base64.NO_WRAP)
                """{"type":"c2_audio","audio_id":"${aud.audioId}","uuid":"${aud.uuid}","mime":"${aud.mimeType}","data":"$b64","duration_sec":${aud.durationSec},"from":"${aud.fromCallsign}","channel":"$channelStr"}"""
            }
            else -> """{"type":"c2_unknown","channel":"$channelStr"}"""
        }
    }

    private suspend fun handleSendWayrenChatMessage(jsonPayload: String): String {
        return try {
            val payload = JSONObject(jsonPayload)
            val text = payload.optString("text", "")
            val callsign = payload.optString("callsign", "Android App")

            val wayrenChannelIdStr = payload.optString("channel", "")
            val wayrenChannelId = if (wayrenChannelIdStr.isNotEmpty()) {
                wayrenChannelIdStr.toULong()
            } else {
                null // will use default in sendWayrenChatMessage
            }
            val priority = if (payload.has("priority")) payload.getInt("priority") else 10

            val success = if (wayrenChannelId != null) {
                grpcClient.sendWayrenChatMessage(text, callsign, wayrenChannelId, priority)
            } else {
                grpcClient.sendWayrenChatMessage(text, callsign, priority = priority)
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

    private suspend fun handleSendC2Payload(jsonPayload: String): String {
        return try {
            val payload = JSONObject(jsonPayload)
            val type = payload.optString("type", "")
            val dataObj = payload.optJSONObject("data")
                ?: return """{"status":"error","message":"data object required"}"""
            val wayrenChannelIdStr = payload.optString("channel", "")
            if (wayrenChannelIdStr.isEmpty()) {
                return """{"status":"error","message":"channel required"}"""
            }
            val wayrenChannelId = wayrenChannelIdStr.toULong()

            val c2Payload = buildC2Payload(type, dataObj)

            if (type == "c2_image" || type == "c2_audio") {
                val dataSize = dataObj.optString("data", "").length
                Log.i(TAG, "Send C2 message: type=$type channel=$wayrenChannelIdStr data_size=${dataSize}B")
            } else {
                Log.i(TAG, "Send C2 message ($jsonPayload)...")
            }

            val priority = if (payload.has("priority")) payload.getInt("priority") else 10

            val success = grpcClient.sendC2Message(c2Payload, wayrenChannelId, priority)
            if (success) {
                """{"status": "ok"}"""
            } else {
                """{"status": "error", "message": "Failed to send C2Payload"}"""
            }
        } catch (e: Exception) {
            """{"status": "error", "message": "sendC2Payload failed: ${e.message}"}"""
        }
    }

    private fun buildC2Payload(type: String, data: JSONObject): com.wayrenprototype.c2.C2.C2Payload {
        return when (type) {
            "c2_chat" -> {
                val chatBuilder = com.wayrenprototype.c2.C2.C2Chat.newBuilder()
                    .setFromCallsign(data.optString("from_callsign", "Android App"))
                    .setText(data.optString("text", ""))
                    .setUuid(data.optString("uuid", ""))
                // Optional: to_callsigns
                val toCallsignsArr = data.optJSONArray("to_callsigns")
                if (toCallsignsArr != null) {
                    for (i in 0 until toCallsignsArr.length()) {
                        chatBuilder.addToCallsigns(toCallsignsArr.optString(i))
                    }
                }
                // Optional: reply_to_message_id
                if (data.has("reply_to_message_id")) {
                    chatBuilder.setReplyToMessageId(data.optString("reply_to_message_id"))
                }
                com.wayrenprototype.c2.C2.C2Payload.newBuilder()
                    .setChat(chatBuilder.build())
                    .build()
            }
            "c2_gis_object" -> {
                val gisBuilder = com.wayrenprototype.c2.C2.C2GISObject.newBuilder()
                    .setObjectId(data.optString("object_id", ""))
                    .setName(data.optString("name", ""))
                // Shape enum
                val shapeStr = data.optString("shape", "SHAPE_ICON")
                gisBuilder.shape = com.wayrenprototype.c2.C2.ShapeType.valueOf(shapeStr)
                // Enum fields
                val actionStr = data.optString("action", "OBJECT_ADD")
                gisBuilder.action = com.wayrenprototype.c2.C2.ObjectAction.valueOf(actionStr)
                val affiliationStr = data.optString("affiliation", "AFFILIATION_UNKNOWN")
                gisBuilder.affiliation = com.wayrenprototype.c2.C2.ObjectAffiliation.valueOf(affiliationStr)
                // Optional: tags
                val tagsArr = data.optJSONArray("tags")
                if (tagsArr != null) {
                    for (i in 0 until tagsArr.length()) {
                        gisBuilder.addTags(tagsArr.optString(i))
                    }
                }
                // Optional: points (repeated)
                val pointsArr = data.optJSONArray("points")
                if (pointsArr != null) {
                    for (i in 0 until pointsArr.length()) {
                        val ptObj = pointsArr.optJSONObject(i)
                        if (ptObj != null) {
                            gisBuilder.addPoints(buildCoordinate(ptObj))
                        }
                    }
                }
                // Optional: course, speed, icon, parent_object_id
                if (data.has("course")) gisBuilder.course = data.optDouble("course")
                if (data.has("speed")) gisBuilder.speed = data.optDouble("speed")
                if (data.has("icon")) gisBuilder.icon = data.optString("icon")
                if (data.has("parent_object_id")) gisBuilder.parentObjectId = data.optString("parent_object_id")

                com.wayrenprototype.c2.C2.C2Payload.newBuilder()
                    .setGisObject(gisBuilder.build())
                    .build()
            }
            "c2_tactical_draw" -> {
                val drawBuilder = com.wayrenprototype.c2.C2.C2TacticalDraw.newBuilder()
                    .setDrawId(data.optString("draw_id", ""))
                    .setName(data.optString("name", ""))
                    .setStrokeWidth(data.optInt("stroke_width", 3))
                    .setStrokeColor(data.optString("stroke_color", "#FF0000"))
                // Optional: timed points
                val pointsArr = data.optJSONArray("points")
                if (pointsArr != null) {
                    for (i in 0 until pointsArr.length()) {
                        val ptObj = pointsArr.optJSONObject(i)
                        if (ptObj != null) {
                            val coordObj = ptObj.optJSONObject("coord")
                            if (coordObj != null) {
                                val timedPoint = com.wayrenprototype.c2.C2.TimedPoint.newBuilder()
                                    .setCoord(buildCoordinate(coordObj))
                                    .setRelativeTimeMs(ptObj.optInt("relative_time_ms", 0))
                                    .build()
                                drawBuilder.addPoints(timedPoint)
                            }
                        }
                    }
                }

                com.wayrenprototype.c2.C2.C2Payload.newBuilder()
                    .setTacticalDraw(drawBuilder.build())
                    .build()
            }
            "c2_image" -> {
                val imgBuilder = com.wayrenprototype.c2.C2.C2Image.newBuilder()
                    .setImageId(data.optString("image_id", ""))
                    .setMimeType(data.optString("mime_type", "image/png"))
                    .setFromCallsign(data.optString("from_callsign", "Android App"))
                    .setUuid(data.optString("uuid", ""))
                // Optional: data (base64 encoded string from frontend)
                val dataStr = data.optString("data", "")
                if (dataStr.isNotEmpty()) {
                    imgBuilder.data = com.google.protobuf.ByteString.copyFrom(
                        android.util.Base64.decode(dataStr, android.util.Base64.DEFAULT)
                    )
                }
                // Optional: caption
                if (data.has("caption")) imgBuilder.caption = data.optString("caption")
                // Optional: geotag
                val geoObj = data.optJSONObject("geotag")
                if (geoObj != null) {
                    imgBuilder.geotag = buildCoordinate(geoObj)
                }

                com.wayrenprototype.c2.C2.C2Payload.newBuilder()
                    .setImage(imgBuilder.build())
                    .build()
            }
            "c2_audio" -> {
                val audBuilder = com.wayrenprototype.c2.C2.C2Audio.newBuilder()
                    .setAudioId(data.optString("audio_id", ""))
                    .setMimeType(data.optString("mime_type", "audio/webm"))
                    .setFromCallsign(data.optString("from_callsign", "Android App"))
                    .setUuid(data.optString("uuid", ""))
                    .setDurationSec(data.optInt("duration_sec", 0))
                val dataStr = data.optString("data", "")
                if (dataStr.isNotEmpty()) {
                    audBuilder.data = com.google.protobuf.ByteString.copyFrom(
                        android.util.Base64.decode(dataStr, android.util.Base64.DEFAULT)
                    )
                }
                com.wayrenprototype.c2.C2.C2Payload.newBuilder()
                    .setAudio(audBuilder.build())
                    .build()
            }
            else -> throw IllegalArgumentException("Unknown C2Payload type: $type")
        }
    }

    /** Parses a JSON object with lat/lng/alt into a C2 Coordinate. */
    private fun buildCoordinate(json: JSONObject): com.wayrenprototype.c2.C2.Coordinate {
        val coordBuilder = com.wayrenprototype.c2.C2.Coordinate.newBuilder()
            .setLat(json.optDouble("lat", 0.0))
            .setLng(json.optDouble("lng", 0.0))
        if (json.has("alt")) {
            coordBuilder.alt = json.optDouble("alt")
        }
        return coordBuilder.build()
    }

    private suspend fun handleCreateWayrenChannel(jsonPayload: String): String {
        return try {
            val payload = JSONObject(jsonPayload)
            val name = payload.optString("name", "")
            if (name.isEmpty()) {
                return """{"status": "error", "message": "name is required"}"""
            }
            val channel = grpcClient.createWayrenChannel(name)
            if (channel != null) {
                """{"status": "ok", "id": "${channel.id.toULong()}", "name": "${channel.name}"}"""
            } else {
                """{"status": "error", "message": "Failed to create channel"}"""
            }
        } catch (e: Exception) {
            """{"status": "error", "message": "createWayrenChannel failed: ${e.message}"}"""
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
