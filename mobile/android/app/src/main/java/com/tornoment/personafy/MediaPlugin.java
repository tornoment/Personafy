package com.tornoment.personafy;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.SystemClock;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/* The page's side of the notification player (mobile/web/android.js stands in for navigator.mediaSession):
   update() — the track, its cover, play/pause and position; the "action" event — a button pressed in the
   notification, on the lock screen, on headphones or a Bluetooth device, or the headphones being pulled out. */
@CapacitorPlugin(name = "PersonafyMedia")
public class MediaPlugin extends Plugin {

    private static MediaPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void update(PluginCall call) {
        final String title = call.getString("title", "");
        final String artist = call.getString("artist", "");
        final String album = call.getString("album", "");
        final boolean playing = Boolean.TRUE.equals(call.getBoolean("playing", false));
        final double position = safe(call.getDouble("position", 0.0));
        final double duration = safe(call.getDouble("duration", 0.0));
        final boolean artGiven = call.getData().has("art");
        Bitmap art = null;
        if (artGiven) {
            String b64 = call.getString("art", "");
            if (b64 != null && !b64.isEmpty()) {
                try {
                    byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                    art = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                } catch (Exception e) {
                    art = null;
                }
            }
        }
        final Bitmap cover = art;
        getBridge().executeOnMainThread(() -> {
            PlaybackService.State s = PlaybackService.state;
            s.title = title;
            s.artist = artist;
            s.album = album;
            s.playing = playing;
            s.positionMs = Math.round(position * 1000);
            s.durationMs = Math.round(duration * 1000);
            s.at = SystemClock.elapsedRealtime();
            if (artGiven) s.art = cover;
            if (playing) s.ever = true;
            PlaybackService.update(getContext());
            call.resolve();
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getBridge().executeOnMainThread(() -> {
            PlaybackService.shutdown();
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        PlaybackService.shutdown();
        if (instance == this) instance = null;
    }

    private static double safe(Double d) {
        return d == null || d.isNaN() || d.isInfinite() || d < 0 ? 0 : d;
    }

    /* to the page: "play", "pause", "nexttrack", "previoustrack", "seekto" (with seekTime, seconds) */
    static void send(String action, Double seekTime) {
        MediaPlugin p = instance;
        if (p == null) return;
        JSObject d = new JSObject();
        d.put("action", action);
        if (seekTime != null) d.put("seekTime", seekTime);
        p.notifyListeners("action", d);
    }
}
