package com.example.wayrenprototype

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
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
import java.io.File

class MainActivity : AppCompatActivity() {

    // gRPC client for communicating with the Wayren Companion service on the same device
    private val grpcClient = GrpcClient()
    private var uploadMessage: ValueCallback<Array<Uri>>? = null
    private var cameraImageUri: Uri? = null

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

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
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
        }

        // Load via the secure app domain instead of file://
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")

        // Continuously monitor the Wayren Companion service connection in the background.
        // Updates isConnected; frontend can query via getConnectionStatus bridge call.
        // Also auto-launches a stream-logging loop once connected.
        lifecycleScope.launch {
            grpcClient.detectGrpcChannelState(lifecycleScope)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        grpcClient.shutdown()
    }
}