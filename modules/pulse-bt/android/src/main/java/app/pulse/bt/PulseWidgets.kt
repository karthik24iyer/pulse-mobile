package app.pulse.bt

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Pulse's two 2x1 home-screen widgets. The app formats everything (src/widgets/snapshot.ts) and saves it as JSON
 * through [PulseWidgets.save]; a widget only lays out two cells of label, value and caption. Each cell opens the
 * matching Pulse screen. Daily cells blank once the phone's date has moved past the snapshot's day.
 */
object PulseWidgets {
  private const val PREFS = "pulse_widgets"
  private const val KEY = "snapshot"
  private const val NONE = "--"

  /** One widget: which snapshot cells go left and right, and the screens they open. */
  data class Spec(val left: String, val right: String, val leftUri: String, val rightUri: String, val leftDaily: Boolean, val rightDaily: Boolean)

  val HEART_STRAIN = Spec("heart", "strain", "pulse://health/heart-rate", "pulse://strain", leftDaily = false, rightDaily = true)
  val FUEL = Spec("water", "calories", "pulse://metric/water", "pulse://nutrition", leftDaily = true, rightDaily = true)

  fun save(context: Context, json: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
    refresh(context, HeartStrainWidget::class.java, HEART_STRAIN)
    refresh(context, FuelWidget::class.java, FUEL)
  }

  private fun refresh(context: Context, cls: Class<*>, spec: Spec) {
    val manager = AppWidgetManager.getInstance(context)
    val ids = manager.getAppWidgetIds(ComponentName(context, cls))
    if (ids.isNotEmpty()) render(context, manager, ids, spec)
  }

  fun render(context: Context, manager: AppWidgetManager, ids: IntArray, spec: Spec) {
    val snapshot = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)?.let {
      try {
        JSONObject(it)
      } catch (e: Exception) {
        null
      }
    }
    val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
    val stale = snapshot?.optString("day") != today
    for (id in ids) {
      val views = RemoteViews(context.packageName, R.layout.pulse_widget_pair)
      fill(views, snapshot?.optJSONObject(spec.left), spec.leftDaily && stale, R.id.label_left, R.id.value_left, R.id.caption_left)
      fill(views, snapshot?.optJSONObject(spec.right), spec.rightDaily && stale, R.id.label_right, R.id.value_right, R.id.caption_right)
      views.setOnClickPendingIntent(R.id.cell_left, open(context, spec.leftUri, id * 2))
      views.setOnClickPendingIntent(R.id.cell_right, open(context, spec.rightUri, id * 2 + 1))
      manager.updateAppWidget(id, views)
    }
  }

  private fun fill(views: RemoteViews, cell: JSONObject?, blank: Boolean, label: Int, value: Int, caption: Int) {
    views.setTextViewText(label, cell?.optString("label") ?: "Pulse")
    views.setTextViewText(value, if (cell == null || blank) NONE else cell.optString("value", NONE))
    views.setTextViewText(caption, cell?.optString("caption") ?: "")
  }

  /** Opens Pulse on `uri` (Expo Router's scheme); a distinct request code per cell keeps the intents apart. */
  private fun open(context: Context, uri: String, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).apply {
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }
}

/** Heart rate (latest or live) beside today's strain. */
class HeartStrainWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = PulseWidgets.render(context, manager, ids, PulseWidgets.HEART_STRAIN)
}

/** Today's water beside today's calories eaten. */
class FuelWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = PulseWidgets.render(context, manager, ids, PulseWidgets.FUEL)
}
