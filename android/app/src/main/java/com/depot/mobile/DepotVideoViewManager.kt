package com.depot.mobile

import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.viewmanagers.DepotVideoViewManagerDelegate
import com.facebook.react.viewmanagers.DepotVideoViewManagerInterface

@ReactModule(name = DepotVideoViewManager.NAME)
class DepotVideoViewManager :
  SimpleViewManager<DepotVideoView>(), DepotVideoViewManagerInterface<DepotVideoView> {

  companion object {
    const val NAME = "DepotVideoView"
  }

  private val delegate = DepotVideoViewManagerDelegate(this)

  override fun getName() = NAME

  override fun getDelegate(): ViewManagerDelegate<DepotVideoView> = delegate

  override fun createViewInstance(context: ThemedReactContext) = DepotVideoView(context)

  override fun onDropViewInstance(view: DepotVideoView) {
    view.release()
    super.onDropViewInstance(view)
  }

  override fun setSource(view: DepotVideoView, value: String?) {
    view.setSource(value.orEmpty())
  }

  override fun setPaused(view: DepotVideoView, value: Boolean) = view.setPaused(value)

  override fun setMuted(view: DepotVideoView, value: Boolean) = view.setMuted(value)

  override fun setLoop(view: DepotVideoView, value: Boolean) = view.setLoop(value)

  override fun setVolume(view: DepotVideoView, value: Double) = view.setVolume(value)

  override fun setRate(view: DepotVideoView, value: Double) = view.setRate(value)

  override fun setSeekMs(view: DepotVideoView, value: Int) = view.seek(value)

  override fun seek(view: DepotVideoView, ms: Int) = view.seek(ms)

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
    mutableMapOf(
      "topVideoLoad" to mapOf("registrationName" to "onVideoLoad"),
      "topVideoProgress" to mapOf("registrationName" to "onVideoProgress"),
      "topVideoEnd" to mapOf("registrationName" to "onVideoEnd"),
      "topVideoError" to mapOf("registrationName" to "onVideoError"),
    )
}
