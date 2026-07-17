package com.example.wayrenprototype

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.ValueCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import java.io.ByteArrayInputStream
import java.io.File

class MainActivity : AppCompatActivity() {

    // gRPC client for communicating with the Wayren Companion service on the same device
    private val grpcClient = GrpcClient()
    private var uploadMessage: ValueCallback<Array<Uri>>? = null
    private var cameraImageUri: Uri? = null

    // Offline map tile reader (PMTiles archive)
    private var pmtilesReader: PMTilesReader? = null

    // Request RECORD_AUDIO runtime permission so WebView getUserMedia can start the mic
    private val audioPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) {
            android.util.Log.w("WayrenApp", "RECORD_AUDIO permission denied by user")
        }
    }

    private val fileChooserLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == RESULT_OK) {
            val uris = if (cameraImageUri != null) {
                // Camera capture — photo saved to our temp file
                arrayOf(cameraImageUri!!)
            } else {
                // File picker gallery
                WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            }
            uploadMessage?.onReceiveValue(uris)
        } else {
            uploadMessage?.onReceiveValue(null)
        }
        uploadMessage = null
        cameraImageUri = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val webView = findViewById<WebView>(R.id.webView)

        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true


        //Enable remote debugging so you can use Chrome DevTools on your computer
        WebView.setWebContentsDebuggingEnabled(true)

        // Instantiate your WebAppInterface and link it using your bridge name
        val webInterface = WebAppInterface(webView, lifecycleScope, grpcClient)
        webView.addJavascriptInterface(webInterface, "AndroidBridge")


        // Configures a virtual secure domain that points to your assets folder
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        // Copy offline map tiles from assets to internal storage (if not yet copied)
        loadPmtiles()

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                val url = request.url.toString()

                // Intercept offline map tile requests (same-origin, no CORS needed)
                if (url.startsWith("https://appassets.androidplatform.net/tiles/")) {
                    return serveMapTile(url)
                }

                // Intercept asset files and serve them under the secure domain
                return assetLoader.shouldInterceptRequest(request.url)
            }
        }

        // Required for <input type="file"> to work in WebView
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                uploadMessage = filePathCallback

                if (fileChooserParams?.isCaptureEnabled == true) {
                    // Camera capture mode
                    val photoFile = File(cacheDir, "camera/${System.currentTimeMillis()}.jpg")
                    photoFile.parentFile?.mkdirs()
                    val photoUri = FileProvider.getUriForFile(
                        this@MainActivity,
                        "${packageName}.fileprovider",
                        photoFile
                    )
                    cameraImageUri = photoUri
                    val cameraIntent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                        putExtra(MediaStore.EXTRA_OUTPUT, photoUri)
                    }
                    fileChooserLauncher.launch(cameraIntent)
                } else {
                    // Gallery picker mode
                    val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                        type = "image/*"
                        addCategory(Intent.CATEGORY_OPENABLE)
                    }
                    fileChooserLauncher.launch(Intent.createChooser(intent, "Select Image"))
                }
                return true
            }

            // Required for getUserMedia (microphone) to work in WebView
            override fun onPermissionRequest(request: PermissionRequest) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    request.grant(request.resources)
                }
            }
        }

        // Load via the secure app domain instead of file://
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")

        // Request RECORD_AUDIO at OS level so WebView getUserMedia doesn't fail
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                audioPermissionLauncher.launch(android.Manifest.permission.RECORD_AUDIO)
            }
        }

        // When the gRPC service reconnects (after a disconnect), tell the frontend
        // to restart its streams (streamAllChannels, streamAllNewMessages).
        grpcClient.onReconnected = {
            webView.post {
                webView.evaluateJavascript(
                    "window.handleGrpcReconnected && window.handleGrpcReconnected()",
                    null
                )
            }
        }

        // Continuously monitor the Wayren Companion service connection in the background.
        // Updates isConnected; frontend can query via getConnectionStatus bridge call.
        // Also auto-launches a stream-logging loop once connected.
        lifecycleScope.launch {
            grpcClient.detectGrpcChannelState(lifecycleScope)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        pmtilesReader?.close()
        grpcClient.shutdown()
    }

    // ── Offline Map Tiles ──

    companion object {
        private const val TAG = "WayrenApp"
        private const val PMTILES_ASSET = "appMap.pmtiles"

        /** MIME type for Mapbox Vector Tiles. */
        private const val MIME_MVT = "application/vnd.mapbox-vector-tile"
    }

    /**
     * Copies the bundled .pmtiles file from Android assets to internal storage.
     * AssetManager doesn't support random-access reads so we need the file on disk.
     */
    private fun loadPmtiles() {
        val dest = File(filesDir, PMTILES_ASSET)
        if (dest.exists()) {
            android.util.Log.i(TAG, "PMTiles already exists at ${dest.absolutePath}")
            pmtilesReader = PMTilesReader(dest.absolutePath)
            return
        }

        try {
            assets.open(PMTILES_ASSET).use { src ->
                dest.outputStream().use { out ->
                    src.copyTo(out)
                }
            }
            android.util.Log.i(TAG, "PMTiles copied to ${dest.absolutePath} (${dest.length()}B)")

            // Create the reader immediately so it's ready for tile requests
            pmtilesReader = PMTilesReader(dest.absolutePath)
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Failed to copy PMTiles from assets: ${e.message}")
        }
    }

    /**
     * Intercepts tile requests (format: /tiles/{z}/{x}/{y}.pbf) and serves
     * the tile from the local PMTiles archive.
     */
    private fun serveMapTile(url: String): WebResourceResponse? {
        val reader = pmtilesReader ?: return null

        try {
            // Parse: https://local.map/tiles/12/3200/2400.pbf
            val regex = Regex(""".*/tiles/(\d+)/(\d+)/(\d+)\.(\w+)$""")
            val match = regex.find(url) ?: return null

            val z = match.groupValues[1].toInt()
            val x = match.groupValues[2].toInt()
            val y = match.groupValues[3].toInt()

            val tileBytes = reader.getTile(z, x, y)
            if (tileBytes == null) {
                android.util.Log.w(TAG, "Tile not found: z=$z x=$x y=$y")
                // Return a 404-style empty response (marker tile = 1x1 transparent PNG or just 404)
                return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null)
            }

            val mime = when (reader.header.tileType) {
                1 -> MIME_MVT     // vector tile
                2 -> "image/png"
                3 -> "image/jpeg"
                4 -> "image/webp"
                else -> "application/octet-stream"
            }

            return WebResourceResponse(mime, null, 200, "OK", null, ByteArrayInputStream(tileBytes))
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Tile serving error: ${e.message}")
            return null
        }
    }
}