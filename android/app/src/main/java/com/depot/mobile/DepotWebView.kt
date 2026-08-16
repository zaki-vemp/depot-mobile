package com.depot.mobile

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper

/**
 * A real Android WebView. The desktop build parks a native child webview over
 * the pane so framing headers never decide what can open; on Android the
 * platform view does the same job inside the tab.
 */
@SuppressLint("SetJavaScriptEnabled")
class DepotWebView(private val reactContext: ThemedReactContext) : WebView(reactContext) {

  private var lastUrl: String = ""
  private var progress: Int = 0

  init {
    settings.javaScriptEnabled = true
    settings.domStorageEnabled = true
    settings.databaseEnabled = true
    settings.loadWithOverviewMode = true
    settings.useWideViewPort = true
    settings.mediaPlaybackRequiresUserGesture = false
    settings.setSupportMultipleWindows(false)
    settings.javaScriptCanOpenWindowsAutomatically = true
    isVerticalScrollBarEnabled = true

    CookieManager.getInstance().setAcceptCookie(true)
    CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

    webViewClient =
      object : WebViewClient() {
        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
          lastUrl = url
          emitNavigation(true)
        }

        override fun onPageFinished(view: WebView, url: String) {
          lastUrl = url
          emitNavigation(false)
        }

        override fun shouldOverrideUrlLoading(
          view: WebView,
          request: WebResourceRequest,
        ): Boolean {
          val url = request.url.toString()
          // Keep http(s) inside the tab; hand app links (intent:, mailto:, …) to Android.
          if (url.startsWith("http://") || url.startsWith("https://")) return false
          return runCatching {
              reactContext.startActivity(
                android.content.Intent(android.content.Intent.ACTION_VIEW, request.url)
                  .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
              )
              true
            }
            .getOrDefault(true)
        }

        override fun onReceivedError(
          view: WebView,
          request: WebResourceRequest,
          error: WebResourceError,
        ) {
          if (request.isForMainFrame) emitError(error.description?.toString() ?: "Page failed to load")
        }
      }

    webChromeClient =
      object : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
          progress = newProgress
          emitNavigation(newProgress < 100)
        }
      }
  }

  fun load(url: String) {
    if (url.isEmpty() || url == lastUrl) return
    lastUrl = url
    loadUrl(url)
  }

  private fun emitNavigation(loading: Boolean) {
    val payload =
      Arguments.createMap().apply {
        putString("url", lastUrl)
        putString("title", title ?: "")
        putBoolean("loading", loading)
        putBoolean("canGoBack", canGoBack())
        putBoolean("canGoForward", canGoForward())
        putInt("progress", progress)
      }
    dispatch("topNavigation", payload)
  }

  private fun emitError(message: String) {
    dispatch("topWebError", Arguments.createMap().apply { putString("message", message) })
  }

  private fun dispatch(name: String, payload: WritableMap) {
    val surfaceId = UIManagerHelper.getSurfaceId(this)
    UIManagerHelper.getEventDispatcherForReactTag(reactContext as ReactContext, id)
      ?.dispatchEvent(DepotEvent(surfaceId, id, name, payload))
  }
}
