package com.example.wayrenprototype

import android.annotation.SuppressLint
import android.util.Log
import android.os.Build
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat

class MainActivity : AppCompatActivity() {

    // gRPC client for communicating with the Wayren Companion service on the same device
    private val grpcClient = GrpcClient()

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val webView = findViewById<android.webkit.WebView>(R.id.webView)

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
                view: android.webkit.WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                // Intercept asset files and serve them under the secure domain
                return assetLoader.shouldInterceptRequest(request.url)
            }
        }

        // Load via the secure app domain instead of file://
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")

        // Keep trying to reach the Wayren Companion service in the background.
        // Automatically succeeds when the companion app is started.
        lifecycleScope.launch {
            grpcClient.waitForService()
            Log.i(TAG, "Wayren Companion service is ready")
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        grpcClient.shutdown()
    }

    companion object {
        private const val TAG = "WayrenApp"
    }
}