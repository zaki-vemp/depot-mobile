package com.depot.mobile

import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.widget.FrameLayout
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper

/**
 * Video and audio playback on Android's own MediaPlayer — no extra playback
 * library in the bundle. React Native draws the transport controls, so the HUD
 * matches the desktop player; this view only owns the surface and the clock.
 */
class DepotVideoView(private val reactContext: ThemedReactContext) : FrameLayout(reactContext) {

  private val surface = SurfaceView(reactContext)
  private val ticker = Handler(Looper.getMainLooper())
  private var player: MediaPlayer? = null
  private var prepared = false
  private var surfaceReady = false

  private var source: String = ""
  private var wantPaused = false
  private var wantMuted = false
  private var wantLoop = false
  private var wantVolume = 1.0f
  private var wantRate = 1.0f
  private var pendingSeek = -1

  private val tick =
    object : Runnable {
      override fun run() {
        val mp = player
        if (mp != null && prepared) {
          val payload =
            Arguments.createMap().apply {
              putInt("timeMs", runCatching { mp.currentPosition }.getOrDefault(0))
              putInt("durationMs", runCatching { mp.duration }.getOrDefault(0))
              putInt("bufferedMs", 0)
            }
          dispatch("topVideoProgress", payload)
        }
        ticker.postDelayed(this, 400)
      }
    }

  init {
    addView(
      surface,
      LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT, Gravity.CENTER),
    )
    surface.holder.addCallback(
      object : SurfaceHolder.Callback {
        override fun surfaceCreated(holder: SurfaceHolder) {
          surfaceReady = true
          player?.setDisplay(holder)
          if (source.isNotEmpty() && player == null) open()
        }

        override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = Unit

        override fun surfaceDestroyed(holder: SurfaceHolder) {
          surfaceReady = false
          player?.setDisplay(null)
        }
      },
    )
  }

  fun setSource(value: String) {
    if (value == source) return
    source = value
    release()
    if (value.isNotEmpty()) open()
  }

  fun setPaused(value: Boolean) {
    wantPaused = value
    val mp = player ?: return
    if (!prepared) return
    if (value) {
      if (mp.isPlaying) mp.pause()
    } else if (!mp.isPlaying) {
      mp.start()
      applyRate()
    }
  }

  fun setMuted(value: Boolean) {
    wantMuted = value
    applyVolume()
  }

  fun setVolume(value: Double) {
    wantVolume = value.toFloat().coerceIn(0f, 1f)
    applyVolume()
  }

  fun setLoop(value: Boolean) {
    wantLoop = value
    player?.isLooping = value
  }

  fun setRate(value: Double) {
    wantRate = value.toFloat().coerceIn(0.25f, 3f)
    applyRate()
  }

  fun seek(ms: Int) {
    if (ms < 0) return
    if (prepared) {
      player?.seekTo(ms)
    } else {
      pendingSeek = ms
    }
  }

  fun release() {
    ticker.removeCallbacks(tick)
    prepared = false
    player?.let {
      runCatching { it.stop() }
      it.release()
    }
    player = null
  }

  private fun open() {
    val mp = MediaPlayer()
    player = mp
    prepared = false
    try {
      mp.setDataSource(reactContext, Uri.parse(source))
      if (surfaceReady) mp.setDisplay(surface.holder)
      mp.isLooping = wantLoop
      mp.setOnPreparedListener {
        prepared = true
        applyVolume()
        if (pendingSeek >= 0) {
          it.seekTo(pendingSeek)
          pendingSeek = -1
        }
        dispatch(
          "topVideoLoad",
          Arguments.createMap().apply {
            putInt("durationMs", runCatching { it.duration }.getOrDefault(0))
            putInt("width", it.videoWidth)
            putInt("height", it.videoHeight)
          },
        )
        if (!wantPaused) {
          it.start()
          applyRate()
        }
        ticker.removeCallbacks(tick)
        ticker.post(tick)
      }
      mp.setOnCompletionListener {
        dispatch("topVideoEnd", Arguments.createMap().apply { putBoolean("playing", false) })
      }
      mp.setOnErrorListener { _, what, extra ->
        dispatch(
          "topVideoError",
          Arguments.createMap().apply {
            putString("message", "Playback failed ($what/$extra) — try opening it with another app")
          },
        )
        true
      }
      mp.setOnVideoSizeChangedListener { _, width, height -> fitSurface(width, height) }
      mp.prepareAsync()
    } catch (e: Exception) {
      dispatch(
        "topVideoError",
        Arguments.createMap().apply { putString("message", e.message ?: "Could not open this file") },
      )
    }
  }

  /** Letterboxes the surface so the video keeps its aspect ratio. */
  private fun fitSurface(videoWidth: Int, videoHeight: Int) {
    if (videoWidth <= 0 || videoHeight <= 0) return
    val boxWidth = width.takeIf { it > 0 } ?: return
    val boxHeight = height.takeIf { it > 0 } ?: return
    val scale = minOf(boxWidth.toFloat() / videoWidth, boxHeight.toFloat() / videoHeight)
    val params = surface.layoutParams as LayoutParams
    params.width = (videoWidth * scale).toInt()
    params.height = (videoHeight * scale).toInt()
    params.gravity = Gravity.CENTER
    surface.layoutParams = params
  }

  private fun applyVolume() {
    val level = if (wantMuted) 0f else wantVolume
    runCatching { player?.setVolume(level, level) }
  }

  private fun applyRate() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
    val mp = player ?: return
    if (!prepared || !mp.isPlaying) return
    runCatching { mp.playbackParams = mp.playbackParams.setSpeed(wantRate) }
  }

  private fun dispatch(name: String, payload: WritableMap) {
    val surfaceId = UIManagerHelper.getSurfaceId(this)
    UIManagerHelper.getEventDispatcherForReactTag(reactContext as ReactContext, id)
      ?.dispatchEvent(DepotEvent(surfaceId, id, name, payload))
  }
}
