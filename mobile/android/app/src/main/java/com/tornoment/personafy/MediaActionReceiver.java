package com.tornoment.personafy;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/* The notification's buttons (prev / play-pause / next) land here and go on to the page. */
public class MediaActionReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent != null ? intent.getAction() : null;
        if (a == null) return;
        switch (a) {
            case PlaybackService.ACTION_PLAY:
                MediaPlugin.send("play", null);
                break;
            case PlaybackService.ACTION_PAUSE:
                MediaPlugin.send("pause", null);
                break;
            case PlaybackService.ACTION_NEXT:
                MediaPlugin.send("nexttrack", null);
                break;
            case PlaybackService.ACTION_PREV:
                MediaPlugin.send("previoustrack", null);
                break;
            default:
                break;
        }
    }
}
