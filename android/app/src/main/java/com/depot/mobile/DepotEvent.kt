package com.depot.mobile

import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.events.Event

/**
 * `Event` has a self-referential type bound, so custom events need a named
 * subclass. One is enough for every view here — the name and payload are all
 * that differ.
 */
class DepotEvent(
  surfaceId: Int,
  viewTag: Int,
  private val name: String,
  private val payload: WritableMap,
) : Event<DepotEvent>(surfaceId, viewTag) {

  override fun getEventName() = name

  override fun getEventData() = payload
}
