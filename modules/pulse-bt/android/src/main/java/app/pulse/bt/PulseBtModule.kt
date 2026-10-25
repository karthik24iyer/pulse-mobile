package app.pulse.bt

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.Intent
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Two things react-native-ble-plx can't do: list the Bluetooth LE devices already paired with the phone (a Fitbit
 * Air paired to Google Health keeps its link and may not advertise, so a scan never sees it), and open another app
 * by its package (Google Health, where Share heart rate lives).
 */
class PulseBtModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PulseBt")

    Function("bondedDevices") { bonded() }

    Function("openApp") { pkg: String -> open(pkg) }

    Function("healthFeatures") { healthFeatures() }
  }

  /**
   * Which feature-gated Health Connect data this phone's Health Connect can serve. Skin temperature and past-data
   * access only exist on newer Health Connect versions; on older ones their permissions never appear in the sheet,
   * so they can't be granted and shouldn't be counted as missing. Null when Health Connect can't be reached.
   */
  private fun healthFeatures(): Map<String, Boolean>? {
    val ctx = appContext.reactContext ?: return null
    return try {
      val features = HealthConnectClient.getOrCreate(ctx).features
      fun available(f: Int) = features.getFeatureStatus(f) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
      mapOf(
        "skinTemperature" to available(HealthConnectFeatures.FEATURE_SKIN_TEMPERATURE),
        "history" to available(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_HISTORY),
        "background" to available(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND),
      )
    } catch (e: Exception) {
      null
    }
  }

  /** Paired LE (or dual-mode) devices as { id: address, name }. Empty without Bluetooth or the Nearby devices permission. */
  @SuppressLint("MissingPermission")
  private fun bonded(): List<Map<String, String?>> {
    val ctx = appContext.reactContext ?: return emptyList()
    val adapter = (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter ?: return emptyList()
    return try {
      adapter.bondedDevices.orEmpty()
        .filter { it.type == BluetoothDevice.DEVICE_TYPE_LE || it.type == BluetoothDevice.DEVICE_TYPE_DUAL }
        .map { mapOf("id" to it.address, "name" to it.name) }
    } catch (e: SecurityException) {
      emptyList()
    }
  }

  private fun open(pkg: String): Boolean {
    val ctx = appContext.reactContext ?: return false
    val intent = ctx.packageManager.getLaunchIntentForPackage(pkg) ?: return false
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return try {
      ctx.startActivity(intent)
      true
    } catch (e: Exception) {
      false
    }
  }
}
