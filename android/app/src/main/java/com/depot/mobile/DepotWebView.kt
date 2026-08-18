package com.depot.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Message
import android.provider.MediaStore
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import java.io.File

/**
 * A real Android WebView, with real `window.open` support.
 *
 * Sign-in providers hand their result back through `window.opener`, so a popup
 * has to be a genuine child of the WebView that opened it — reporting the URL
 * and loading it somewhere else silently breaks Dropbox's "Continue with
 * Google/Apple/Microsoft" buttons. `onCreateWindow` therefore builds a child
 * WebView, hands it back through the transport, and parks it over the page
 * until the site calls `window.close()`.
 *
 * This is the Android shape of the desktop's `on_new_window` handler.
 */
@SuppressLint("SetJavaScriptEnabled", "ViewConstructor")
class DepotWebView(private val reactContext: ThemedReactContext) : FrameLayout(reactContext) {

  companion object {
    /**
     * This device's own user agent with the two tokens that mark it as an
     * embedded browser removed. Meta serves a cut-down page to anything
     * carrying `wv`, and Google's sign-in refuses it outright with
     * `disallowed_useragent`; everything else about the string stays true.
     */
    fun chromeAgent(context: android.content.Context): String =
      WebSettings.getDefaultUserAgent(context)
        .replace(Regex(";\\s*wv\\b"), "")
        .replace(Regex("\\bVersion/[\\d.]+\\s*"), "")
        .replace(Regex("\\s{2,}"), " ")
        .trim()

    /**
     * The one agent here that is a deliberate fiction: "request desktop site"
     * only means anything if the page is told there is no phone on the other
     * end, so the mobile tokens go and a desktop platform takes their place.
     */
    fun desktopAgent(context: android.content.Context): String =
      chromeAgent(context)
        .replace(Regex("\\(Linux; Android[^)]*\\)"), "(X11; Linux x86_64)")
        .replace(" Mobile", "")

    fun agentFor(context: android.content.Context, mode: String?): String? =
      when (mode) {
        "chrome" -> chromeAgent(context)
        "desktop" -> desktopAgent(context)
        else -> null
      }
  }

  val web = WebView(reactContext)

  /**
   * RN cannot see a WebView's scroll position, so pull-to-refresh has to be the
   * platform's own widget wrapped around the page.
   */
  private val refresher = SwipeRefreshLayout(reactContext)
  private var popup: WebView? = null

  private var lastUrl: String = ""
  private var pendingUrl: String? = null
  private var progress: Int = 0

  /**
   * The UA every WebView here reports. Android's default carries `wv`, which
   * Meta and Google both treat as an embedded browser — Facebook degrades the
   * page and Google's sign-in refuses it outright with `disallowed_useragent`.
   * It is applied in [configure] rather than on the main view alone so popup
   * children inherit it; a sign-in popup on the default UA is exactly the case
   * that breaks.
   */
  private var agent: String? = null

  /** In-page fullscreen video, parked over everything until the page ends it. */
  private var customView: View? = null
  private var customCallback: WebChromeClient.CustomViewCallback? = null

  /** The page's file picker is waiting on this; it must be answered exactly once. */
  private var chooser: ValueCallback<Array<Uri>>? = null
  private var capture: Uri? = null

  init {
    refresher.addView(web, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    addView(refresher, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    // Only arm the gesture at the very top, or it fights the feed's own scroll.
    refresher.setOnChildScrollUpCallback { _, _ -> web.scrollY > 0 }
    refresher.setOnRefreshListener { web.reload() }
    configure(web)

    CookieManager.getInstance().setAcceptCookie(true)
    CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

    web.webViewClient = client(main = true)
    web.webChromeClient = chrome(main = true)
    web.setDownloadListener(
      DownloadListener { url, userAgent, disposition, mimeType, _ ->
        // `blob:` and `data:` URLs exist only inside the page, so there is
        // nothing for DownloadManager to fetch; those still go out to Android.
        runCatching { Downloads.save(reactContext, url, userAgent, disposition, mimeType) }
          .onSuccess { emitDownload(it.name, it.absolutePath) }
          .onFailure {
            runCatching {
              reactContext.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
              )
            }
          }
      },
    )

    // A long press on a picture offers to keep it, rather than selecting text
    // that is not there. Everything else falls through to the page.
    web.setOnLongClickListener {
      val hit = web.hitTestResult
      val image =
        hit.type == WebView.HitTestResult.IMAGE_TYPE ||
          hit.type == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE
      val src = hit.extra
      if (image && !src.isNullOrEmpty() && src.startsWith("http")) {
        emitImage(src)
        true
      } else {
        false
      }
    }
  }

  private fun configure(view: WebView) {
    view.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      databaseEnabled = true
      loadWithOverviewMode = true
      useWideViewPort = true
      mediaPlaybackRequiresUserGesture = false
      javaScriptCanOpenWindowsAutomatically = true
      // Required for `window.open` to reach onCreateWindow at all.
      setSupportMultipleWindows(true)
      cacheMode = WebSettings.LOAD_DEFAULT
      mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
      agent?.let { userAgentString = it }
    }
    view.isVerticalScrollBarEnabled = true
  }

  /**
   * Applies a user agent to this view and any popup it has open. Props arrive
   * in an arbitrary order, so [load] defers the first navigation by a frame and
   * a UA that lands after a page has already started reloads it.
   */
  fun setAgent(value: String?) {
    if (value == agent) return
    agent = value
    // Null hands the platform default back; the setter documents that contract.
    web.settings.userAgentString = value
    popup?.settings?.userAgentString = value
    if (lastUrl.isNotEmpty()) web.reload()
  }

  fun reload() {
    web.reload()
  }

  /** Saves an image the user long-pressed, cookies and all. */
  fun saveUrl(url: String) {
    runCatching { Downloads.save(reactContext, url, web.settings.userAgentString, null, null) }
      .onSuccess { emitDownload(it.name, it.absolutePath) }
      .onFailure { emitError(it.message ?: "That file could not be saved") }
  }

  // Explicit return types: `chrome` builds child clients by calling itself, and
  // Kotlin cannot infer through that.
  private fun client(main: Boolean): WebViewClient =
    object : WebViewClient() {
      override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        if (main) {
          lastUrl = url
          emitNavigation(true)
        }
      }

      override fun onPageFinished(view: WebView, url: String) {
        if (main) {
          lastUrl = url
          refresher.isRefreshing = false
          emitNavigation(false)
        }
      }

      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url.toString()
        // Keep http(s) inside the tab; hand app links (intent:, mailto:, …) to Android.
        if (url.startsWith("http://") || url.startsWith("https://")) return false
        return runCatching {
            reactContext.startActivity(
              Intent(Intent.ACTION_VIEW, request.url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
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
        if (main && request.isForMainFrame) {
          refresher.isRefreshing = false
          emitError(error.description?.toString() ?: "Page failed to load")
        }
      }
    }

  private fun chrome(main: Boolean): WebChromeClient =
    object : WebChromeClient() {
      override fun onProgressChanged(view: WebView, newProgress: Int) {
        if (main) {
          progress = newProgress
          emitNavigation(newProgress < 100)
        }
      }

      override fun onCreateWindow(
        view: WebView,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: Message?,
      ): Boolean {
        val transport = resultMsg?.obj as? WebView.WebViewTransport ?: return false
        val child = WebView(reactContext)
        configure(child)
        child.webViewClient = client(main = false)
        child.webChromeClient = chrome(main = false)
        CookieManager.getInstance().setAcceptThirdPartyCookies(child, true)

        closePopup()
        popup = child
        addView(child, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))

        transport.webView = child
        resultMsg.sendToTarget()
        emitPopup(true)
        return true
      }

      override fun onCloseWindow(window: WebView) {
        if (window === popup) {
          closePopup()
        }
      }

      /**
       * The page's `<input type="file">`. Stories and Reels both go through
       * here, so it offers the camera alongside the gallery. The callback has
       * to be answered on every path — cancelling included — or the page's
       * picker stays wedged until the tab is destroyed.
       */
      override fun onShowFileChooser(
        webView: WebView,
        filePathCallback: ValueCallback<Array<Uri>>,
        params: FileChooserParams,
      ): Boolean {
        if (!main) return false
        chooser?.onReceiveValue(null)
        chooser = filePathCallback
        capture = null

        val pick = params.createIntent()
        val camera = captureIntent(params)
        val chooserIntent =
          Intent(Intent.ACTION_CHOOSER).apply {
            putExtra(Intent.EXTRA_INTENT, pick)
            putExtra(Intent.EXTRA_TITLE, params.title ?: "Choose a file")
            if (camera != null) putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(camera))
          }

        val launched =
          ActivityResults.launch(reactContext.currentActivity, chooserIntent) { code, data ->
            val pending = chooser
            chooser = null
            val shot = capture
            capture = null
            val picked =
              when {
                code != android.app.Activity.RESULT_OK -> null
                data?.data != null || data?.clipData != null ->
                  FileChooserParams.parseResult(code, data)
                // A camera app answers with an empty intent; the photo is at
                // the URI we handed it.
                shot != null -> arrayOf(shot)
                else -> null
              }
            pending?.onReceiveValue(picked)
          }

        if (!launched) {
          chooser = null
          capture = null
          filePathCallback.onReceiveValue(null)
          emitError("No app on this device can pick a file")
          return false
        }
        return true
      }

      /**
       * Camera and microphone for `getUserMedia`. The page's request can only
       * be granted once Android's own runtime grant is held, so the first tap
       * asks for it and denies this round; the page retries on the next tap.
       */
      override fun onPermissionRequest(request: PermissionRequest) {
        val wanted =
          request.resources.filter {
            it == PermissionRequest.RESOURCE_VIDEO_CAPTURE ||
              it == PermissionRequest.RESOURCE_AUDIO_CAPTURE
          }
        if (wanted.isEmpty()) {
          request.deny()
          return
        }
        val missing = mutableListOf<String>()
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE in wanted && !holds(Manifest.permission.CAMERA)) {
          missing += Manifest.permission.CAMERA
        }
        if (
          PermissionRequest.RESOURCE_AUDIO_CAPTURE in wanted &&
            !holds(Manifest.permission.RECORD_AUDIO)
        ) {
          missing += Manifest.permission.RECORD_AUDIO
        }
        if (missing.isEmpty()) {
          request.grant(wanted.toTypedArray())
          return
        }
        reactContext.currentActivity?.requestPermissions(missing.toTypedArray(), 0)
        request.deny()
      }

      override fun onShowCustomView(view: View, callback: CustomViewCallback) {
        if (!main || customView != null) {
          callback.onCustomViewHidden()
          return
        }
        customView = view
        customCallback = callback
        addView(view, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        systemBars(visible = false)
      }

      override fun onHideCustomView() {
        val view = customView ?: return
        removeView(view)
        customView = null
        customCallback?.onCustomViewHidden()
        customCallback = null
        systemBars(visible = true)
      }
    }

  private fun holds(permission: String) =
    ContextCompat.checkSelfPermission(reactContext, permission) == PackageManager.PERMISSION_GRANTED

  /** A camera entry for the file chooser, or null when nothing can take one. */
  private fun captureIntent(params: WebChromeClient.FileChooserParams): Intent? {
    if (!holds(Manifest.permission.CAMERA)) return null
    val video = params.acceptTypes.any { it.startsWith("video/") }
    val intent = Intent(if (video) MediaStore.ACTION_VIDEO_CAPTURE else MediaStore.ACTION_IMAGE_CAPTURE)
    if (intent.resolveActivity(reactContext.packageManager) == null) return null
    return runCatching {
        val dir = File(reactContext.cacheDir, "web-capture").apply { mkdirs() }
        val file = File(dir, "capture-${System.currentTimeMillis()}.${if (video) "mp4" else "jpg"}")
        val uri =
          FileProvider.getUriForFile(reactContext, "${reactContext.packageName}.files", file)
        capture = uri
        intent.putExtra(MediaStore.EXTRA_OUTPUT, uri)
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        intent
      }
      .getOrNull()
  }

  /** Hides the status and navigation bars while a page plays video fullscreen. */
  private fun systemBars(visible: Boolean) {
    val window = reactContext.currentActivity?.window ?: return
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    WindowCompat.setDecorFitsSystemWindows(window, visible)
    if (visible) {
      controller.show(WindowInsetsCompat.Type.systemBars())
    } else {
      controller.hide(WindowInsetsCompat.Type.systemBars())
      controller.systemBarsBehavior =
        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }
  }

  /** Dismisses the sign-in popup — from `window.close()` or the app's own control. */
  fun closePopup() {
    val child = popup ?: return
    popup = null
    (child.parent as? ViewGroup)?.removeView(child)
    child.stopLoading()
    child.webChromeClient = null
    child.destroy()
    emitPopup(false)
  }

  fun hasPopup() = popup != null

  /**
   * Props arrive in an arbitrary order within a frame, so the navigation is
   * posted rather than run inline — otherwise a `url` set before `userAgent`
   * fetches the page with the wrong agent and has to be thrown away.
   */
  fun load(url: String) {
    if (url.isEmpty() || url == lastUrl) return
    lastUrl = url
    pendingUrl = url
    post {
      val next = pendingUrl ?: return@post
      pendingUrl = null
      web.loadUrl(next)
    }
  }

  fun destroyAll() {
    chooser?.onReceiveValue(null)
    chooser = null
    customView?.let {
      removeView(it)
      customCallback?.onCustomViewHidden()
      systemBars(visible = true)
    }
    customView = null
    customCallback = null
    closePopup()
    web.stopLoading()
    web.loadUrl("about:blank")
    web.destroy()
  }

  private fun emitNavigation(loading: Boolean) {
    dispatch(
      "topNavigation",
      Arguments.createMap().apply {
        putString("url", lastUrl)
        putString("title", web.title ?: "")
        putBoolean("loading", loading)
        putBoolean("canGoBack", web.canGoBack())
        putBoolean("canGoForward", web.canGoForward())
        putInt("progress", progress)
      },
    )
  }

  private fun emitPopup(open: Boolean) {
    dispatch("topPopup", Arguments.createMap().apply { putBoolean("open", open) })
  }

  private fun emitDownload(name: String, path: String) {
    dispatch(
      "topDownload",
      Arguments.createMap().apply {
        putString("name", name)
        putString("path", path)
      },
    )
  }

  private fun emitImage(url: String) {
    dispatch("topImage", Arguments.createMap().apply { putString("url", url) })
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
