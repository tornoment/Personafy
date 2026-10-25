import UIKit
import MediaPlayer
import Capacitor

/* The bridge's screen, with the app's own native plugin registered on it (SceneDelegate uses it). */
class PersonafyViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LockScreenPlugin())
    }
}

/* The lock screen and Control Center player. The web view offers "10 s back / forward" there for its music
   whatever the page asks for; this turns those two off and the track buttons on, and tells the page
   (app.js, "PersonafyLockScreen") when a track button is pressed. The web view may switch the 10 s buttons
   back on when a track changes or playback starts, so the page calls apply() again at those moments. */
@objc(LockScreenPlugin)
public class LockScreenPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LockScreenPlugin"
    public let jsName = "PersonafyLockScreen"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "apply", returnType: CAPPluginReturnPromise)
    ]
    private var attached = false

    override public func load() {
        DispatchQueue.main.async { [weak self] in
            self?.attach()
        }
    }

    private func attach() {
        if attached { return }
        attached = true
        let center = MPRemoteCommandCenter.shared()
        center.nextTrackCommand.addTarget { [weak self] _ in
            self?.notifyListeners("command", data: ["action": "nexttrack"])
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            self?.notifyListeners("command", data: ["action": "previoustrack"])
            return .success
        }
        applyCommands()
    }

    private func applyCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.skipForwardCommand.isEnabled = false
        center.skipBackwardCommand.isEnabled = false
        center.nextTrackCommand.isEnabled = true
        center.previousTrackCommand.isEnabled = true
    }

    @objc func apply(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.attach()
            self?.applyCommands()
            call.resolve()
        }
    }
}
