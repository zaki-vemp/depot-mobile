package com.depot.mobile

import android.webkit.WebSettings
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.viewmanagers.DepotWebViewManagerDelegate
import com.facebook.react.viewmanagers.DepotWebViewManagerInterface

@ReactModule(name = DepotWebViewManager.NAME)
class DepotWebViewManager :
  SimpleViewManager<DepotWebView>(), DepotWebViewManagerInterface<DepotWebView> {

  companion object {
    const val NAME = "DepotWebView"
  }

  private val delegate = DepotWebViewManagerDelegate(this)

  override fun getName() = NAME

  override fun getDelegate(): ViewManagerDelegate<DepotWebView> = delegate

  override fun createViewInstance(context: ThemedReactContext) = DepotWebView(context)

  override fun onDropViewInstance(view: DepotWebView) {
    view.destroyAll()
    super.onDropViewInstance(view)
  }

  override fun setUrl(view: DepotWebView, value: String?) {
    value?.let(view::load)
  }

  /** `default`, `chrome` or `desktop` — see [DepotWebView.agentFor]. */
  override fun setUserAgent(view: DepotWebView, value: String?) {
    view.setAgent(DepotWebView.agentFor(view.context, value))
  }

  override fun setIncognito(view: DepotWebView, value: Boolean) {
    view.web.settings.cacheMode =
      if (value) WebSettings.LOAD_NO_CACHE else WebSettings.LOAD_DEFAULT
  }

  /** Back first dismisses a sign-in popup, then walks the page's own history. */
  override fun goBack(view: DepotWebView) {
    if (view.hasPopup()) {
      view.closePopup()
      return
    }
    if (view.web.canGoBack()) view.web.goBack()
  }

  override fun goForward(view: DepotWebView) {
    if (view.web.canGoForward()) view.web.goForward()
  }

  override fun reload(view: DepotWebView) {
    view.reload()
  }

  override fun loadUrl(view: DepotWebView, url: String?) {
    url?.let(view::load)
  }

  override fun closePopup(view: DepotWebView) {
    view.closePopup()
  }

  override fun saveUrl(view: DepotWebView, url: String?) {
    url?.let(view::saveUrl)
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
    mutableMapOf(
      "topNavigation" to mapOf("registrationName" to "onNavigation"),
      "topWebError" to mapOf("registrationName" to "onWebError"),
      "topPopup" to mapOf("registrationName" to "onPopup"),
      "topDownload" to mapOf("registrationName" to "onDownload"),
      "topImage" to mapOf("registrationName" to "onImage"),
    )
}
