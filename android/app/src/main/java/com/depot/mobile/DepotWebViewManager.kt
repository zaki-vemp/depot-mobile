package com.depot.mobile

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
    view.stopLoading()
    view.loadUrl("about:blank")
    view.destroy()
    super.onDropViewInstance(view)
  }

  override fun setUrl(view: DepotWebView, value: String?) {
    value?.let(view::load)
  }

  override fun setUserAgent(view: DepotWebView, value: String?) {
    if (!value.isNullOrEmpty()) view.settings.userAgentString = value
  }

  override fun setIncognito(view: DepotWebView, value: Boolean) {
    view.settings.cacheMode =
      if (value) android.webkit.WebSettings.LOAD_NO_CACHE
      else android.webkit.WebSettings.LOAD_DEFAULT
  }

  override fun goBack(view: DepotWebView) {
    if (view.canGoBack()) view.goBack()
  }

  override fun goForward(view: DepotWebView) {
    if (view.canGoForward()) view.goForward()
  }

  override fun reload(view: DepotWebView) {
    view.reload()
  }

  override fun loadUrl(view: DepotWebView, url: String?) {
    url?.let(view::load)
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
    mutableMapOf(
      "topNavigation" to mapOf("registrationName" to "onNavigation"),
      "topWebError" to mapOf("registrationName" to "onWebError"),
    )
}
