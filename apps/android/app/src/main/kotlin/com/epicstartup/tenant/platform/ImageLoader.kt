package com.epicstartup.tenant.platform

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import java.net.HttpURLConnection
import java.net.URL

/**
 * Loads the org's site icon without an image library.
 *
 * Coil/Glide would add hundreds of kilobytes and a disk cache for a single
 * 36dp image, so this is a tiny memory cache plus `BitmapFactory`. Failures are
 * silent: the header simply renders without an icon.
 */
object ImageLoader {
	private val cache = LruCache<String, Bitmap>(16)
	private val inFlight = mutableSetOf<String>()

	fun load(url: String, onLoaded: (Bitmap) -> Unit) {
		cache.get(url)?.let {
			onLoaded(it)
			return
		}
		synchronized(inFlight) {
			if (!inFlight.add(url)) return
		}

		TaskRunner.run(
			work = { fetch(url) },
			onSuccess = { bitmap ->
				synchronized(inFlight) { inFlight.remove(url) }
				if (bitmap != null) {
					cache.put(url, bitmap)
					onLoaded(bitmap)
				}
			},
			onFailure = { synchronized(inFlight) { inFlight.remove(url) } },
		)
	}

	private fun fetch(url: String): Bitmap? {
		val connection = URL(url).openConnection() as HttpURLConnection
		return try {
			connection.connectTimeout = 10_000
			connection.readTimeout = 10_000
			connection.instanceFollowRedirects = true
			if (connection.responseCode !in 200..299) return null
			connection.inputStream.use { BitmapFactory.decodeStream(it) }
		} catch (error: Exception) {
			null
		} finally {
			connection.disconnect()
		}
	}
}
